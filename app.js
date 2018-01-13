require('dotenv').config({path: 'config.env'});
const botbuilder = require('botbuilder');
const restify = require('restify');
const axios = require('axios');
const truncate = require('truncate');
const dateFormat = require('dateformat');
const eventbrite_start_url = 'https://www.eventbriteapi.com/v3/';

// Setup restify server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function(){
    console.log('%s bot started at %s', server.name, server.url);
});

// Create chat connector
let connector = new botbuilder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

var bot = new botbuilder.UniversalBot(connector);

// Listening for user input
server.post('/api/messages', connector.listen());

let recognizer = new botbuilder.LuisRecognizer(process.env.LUIS_ENDPOINT);
bot.recognizer(recognizer);

bot.dialog('/', function (session) {
    if (session.userData.token) {
        session.beginDialog('Default');
    } else {
        session.beginDialog('Login');
    }
});

bot.use({
    botbuilder: function (session, next) {
        session.send();
        session.sendTyping();
        next();
    }
});

var show_user_preferences = function(session) {
    session.send("Your event preferences : \n\n Event Kind : "+ session.userData.event_human_keyword + "\n\n" +
        "Event Place : "+ session.userData.event_human_location + "\n\n" +
        "Event Category : "+ session.userData.event_human_category + "\n\n" +
        "Event Price : "+ session.userData.event_price + "\n\n" +
        "Event Date : "+ session.userData.event_human_date);
    session.endDialog();
}

var hero_card = function(session, title, text, buttons) {
    const msg = new botbuilder.Message(session)
        .attachments([
            new botbuilder.HeroCard(session)
                .title(title)
                .text(text)
                .buttons(buttons)
        ]);
    botbuilder.Prompts.text(session, msg);
}

bot.dialog('Default', [
    function(session) {
        hero_card(
            session,
            'Hi ' + session.userData.username + ', nice to see you',
            'Thanks for joining our event program! We’d love to help you to find an event',
            [
                botbuilder.CardAction.imBack(session, 'update preferences', 'update preferences'),
                botbuilder.CardAction.imBack(session, 'get preferences', 'get preferences'),
                botbuilder.CardAction.imBack(session, 'suggest me events', 'suggest me events'),
            ]
        )
    }
]);

bot.dialog('Login', [
    function(session) {
        var msg = new botbuilder.Message(session)
            .attachments([
                new botbuilder.SigninCard(session)
                    .text("Authorization needed")
                    .button("Login", "https://www.eventbrite.com/oauth/authorize?response_type=code&client_id=" + process.env.EVENTBRITE_CLIENT_ID)
            ]);
        botbuilder.Prompts.text(session, msg);
    }, function(session, results) {
        session.userData.token = process.env.TOKEN_TEST;
        axios.get(eventbrite_start_url + 'users/me?token=' + session.userData.token)
            .then(function(response) {
                session.userData.username = response.data.first_name;
                session.beginDialog('Default');
            })
            .catch(function(error) {
                console.log('ERROR :' + error);
            });
    }
]);

bot.dialog('UpdateEventPreferences', [
    function (session) {
        botbuilder.Prompts.text(session, 'Have you an idea of event behind your head ? Just say "no matter" if you want to skip ');
    }, function (session, results) {
        if (results.response) {
            session.userData.event_human_keyword = results.response;
            session.userData.event_keyword = results.response.replace(/ /g,"_");
            botbuilder.Prompts.text(session, 'Where would you like to go ?  Just say "no matter" if you want to skip ');
        }
    }, function (session, results) {
        if (results.response) {
            console.log(results.response)
            session.userData.event_human_location = results.response;
            session.userData.event_location = results.response.replace(/ /g,"_");
            botbuilder.Prompts.choice(session, "Could you choose a price format ?", "Free|Paid|No Matter", { listStyle: botbuilder.ListStyle.button });
        }
    }, function (session, results) {
        if (results.response.entity) {
            session.userData.event_price = results.response.entity;
            botbuilder.Prompts.text(session, 'When would you like to go (dd/mm/yyyy) ?  Just say "no matter" if you want to skip ');
        }
    }, function (session, results) {
        if (results.response) {
            let time = results.response.split('/');
            session.userData.event_human_date = results.response
            session.userData.event_date = time[2] + '-' + time[1] + '-' + time[0] + 'T13:00:00';
            const categories_hash = {}
            axios.get(eventbrite_start_url + 'categories/?expand=venue&token=' + session.userData.token)
            .then(function (response) {
                response.data.categories.forEach(function (value) {
                    categories_hash[value.name] = {id: value.id}
                });
                categories_hash['No Matter'] = {id: 'nil'}
                var suggestions_array = []
                response.data.categories.forEach(function (value) {
                    suggestions_array.push(botbuilder.CardAction.postBack(session, "category_name=" + value.name, value.name))
                });
                var msg = new botbuilder.Message(session)
                    .text("Which kind of event could interest you ?")
                    .suggestedActions(botbuilder.SuggestedActions.create(
                        session, suggestions_array
                    ));
                session.send(msg);
                session.userData.categories = categories_hash;
            })
            .catch(function (error) {
                console.log("ERROR: " + error);
            });
        }
    }
]).cancelAction('cancelAction', 'Ok, cancel.', {
    matches: /^nevermind$|^cancel$/i,
    confirmPrompt: "Are you sure?"
}).triggerAction({
    matches: /^(update preferences)/i
});

bot.dialog('SaveCategory', [
    function (session, args) {
        var intent = args.intent.matched.input;
        session.userData.event_human_category = intent.split('category_name=')[1];
        session.userData.event_category = session.userData.categories[intent.split('category_name=')[1]].id;
        show_user_preferences(session);
        session.beginDialog('EventsSuggestions');
    }
]).triggerAction({
    matches: /^(category_name)/i
});

bot.dialog('GetEventPreferences', [
    function (session) {
        show_user_preferences(session)
    }
]).triggerAction({
    matches: /^(get preferences)/i
});

bot.dialog('EventsSuggestions', [
    function (session) {
        if (session.userData.token) {
            let event_kind = session.userData.event_keyword && session.userData.event_keyword != 'no_matter' ? '&q=' + session.userData.event_keyword : '';
            let event_location = session.userData.event_location && session.userData.event_location != 'no_matter' ? '&location.address='+ session.userData.event_location : '';
            let event_category = session.userData.event_category && session.userData.event_category != 'nil' ? '&categories='+ session.userData.event_category : '';
            let event_price =  session.userData.event_price && session.userData.event_price != 'No Matter' ? '&price='+ session.userData.event_price : '';
            let event_date = session.userData.event_date && session.userData.event_date.indexOf('undefined') < 0 ? '&start_date.range_start='+ session.userData.event_date : '';

            axios.get(eventbrite_start_url + 'events/search?expand=venue&token='
                +  session.userData.token + "&sort_by=date"
                + event_kind
                + event_location
                + event_category
                + event_price
                + event_date
            )
            .then(function(response) {
                if(response.data.events.length) {
                    var cards = getCardsAttachments(session, response);
                    // create reply with Carousel AttachmentLayout
                    var reply = new botbuilder.Message(session)
                                .attachmentLayout(botbuilder.AttachmentLayout.carousel)
                                .attachments(cards);
                    session.endDialog(reply);
                } else {
                    hero_card(
                        session,
                        'Sorry',
                        'We didn\'t find any event matching with your preferences. You should change them',
                        [
                            botbuilder.CardAction.imBack(session, 'update preferences', 'update preferences'),
                        ]
                    )
                }
            })
            .catch(function(error) {
                console.log("ERROR: "+ error);
            });
        } else {
            session.beginDialog('Login');
        }
    }
]).triggerAction({
    matches: /^(suggest me events)/i
});

bot.dialog('Weather', [
    function (session, args) {
        session.dialogData = {};
        var event_id = args.intent.matched.input;
        var hash = JSON.parse("[{" + event_id.substring(event_id.lastIndexOf("{") + 1 , event_id.lastIndexOf("}")) + "}]");
        axios.get(eventbrite_start_url + 'events/' + hash[0].id + '?expand=venue&token=' +  session.userData.token)
        .then(function(response) {
            if ( typeof response.data.venue !== 'undefined' && response.data.venue )
            {
                let start_date = new Date(response.data.start.utc);
                let month = start_date.getUTCMonth() + 1;
                let day = start_date.getUTCDate();
                let year = start_date.getUTCFullYear();
                let date_parser = Date.parse(month + " " + day + ", " + year) - Date.parse(((new Date).getUTCMonth() + 1) + " " + (new Date).getUTCDate() + ", " +(new Date).getUTCFullYear());
                let time = date_parser.toString().slice(0,8);
                let event_name = response.data.name.text;
                let latitude = response.data.venue.address.latitude;
                let longitude = response.data.venue.address.longitude;

                axios.get(' https://api.darksky.net/forecast/' + process.env.DARKSKY_CLIENT_ID + '/' + latitude + ',' + longitude + ',' + time + '?exclude=currently,flags')
                .then(function(response) {
                    if(response.data.daily) {
                        let image_url;
                        switch(response.data.daily.data[0].icon) {
                            case 'clear-day':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/day.svg'
                                break;
                            case 'clear-night':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/night.svg'
                                break;
                            case 'rain':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/rainy-6.svg'
                                break;
                            case 'snow':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/snowy-6.svg'
                                break;
                            case 'sleet':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/snowy-3.svg'
                                break;
                            case 'wind':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/cloudy.svg'
                                break;
                            case 'fog':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/cloudy.svg'
                                break;
                            case 'cloudy':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/cloudy.svg'
                                break;
                            case 'partly-cloudy-day':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/cloudy-day-3.svg'
                                break;
                            case 'partly-cloudy-night':
                                image_url = 'https://www.amcharts.com/wp-content/themes/amcharts2/css/img/icons/weather/animated/cloudy-night-3.svg'
                                break;
                        }
                        var msg = new botbuilder.Message(session)
                        .attachments([
                            new botbuilder.ThumbnailCard(session)
                                .title('Weather forecast for ' + event_name)
                                .text(response.data.daily.data[0].summary+"\n\n Temperature Min : "+ response.data.daily.data[0].temperatureMin +"\n\n"+" Temperature Max : "+ response.data.daily.data[0].temperatureMax +"\n\n"+" Humidiy : "+ response.data.daily.data[0].humidity)
                                .images([
                                    botbuilder.CardImage.create(session, image_url)
                                ])
                        ]);
                        session.endDialog(msg);
                    } else {
                        session.endDialog('Sorry, I can\'t find weather forecast for this event');
                    }
                })
                .catch(function(error) {
                    console.log("err: "+ error);
                });
            } else {
                session.endDialog('Sorry, I can\'t find weather forecast for this event');
            }
        })
        .catch(function(error) {
            console.log("ERROR: "+ error);
        });
    }
]).triggerAction({matches: /^(weather forecast)/i });

bot.dialog('AskUserPosition', [
    function (session) {
        session.send('To help you to find an itinerary, we need to know your origin position')
        botbuilder.Prompts.text(session, 'First, what the origin address ?');
    }, function (session, results) {
        if (results.response) {
            session.userData.address = results.response;
            session.beginDialog('OpenGoogleMap');
        }
    }
]).cancelAction('cancelAction', 'Ok, cancel.', {
    matches: /^nevermind$|^cancel$/i,
    confirmPrompt: "Are you sure?"
});

bot.dialog('Itinerary', [
    function (session, args) {
        event_id = args.intent.matched.input;
        var hash = JSON.parse("[{" + event_id.substring(event_id.lastIndexOf("{") + 1 , event_id.lastIndexOf("}")) + "}]");
        session.userData.current_event_id = hash[0].id
        if (session.userData.address) {
            session.send('I already saved an origin position : ' + session.userData.address);
            botbuilder.Prompts.choice(session, "Would you like to continue with it ?", 'Yes|No', { listStyle: botbuilder.ListStyle.button });
        } else {
            session.beginDialog('AskUserPosition');
        }
    }, function (session, results) {
        if (results.response.entity) {
            if (results.response.entity == 'Yes') {
                session.beginDialog('OpenGoogleMap');
            } else {
                session.beginDialog('AskUserPosition');
            }
        }
    }
]).triggerAction({matches: /^(itinerary)/i });

bot.dialog('OpenGoogleMap', [
    function (session) {
        botbuilder.Prompts.choice(session, "Would yo choose a specific travel mode ?", 'Driving|Bicycling|Transit|Walking|No Matter', { listStyle: botbuilder.ListStyle.button });
    }, function (session, results) {
        if (results.response.entity) {
            let travel_mode = results.response.entity != 'No Matter' ? '&travel_mode=' + results.response.entity : '';
            axios.get(eventbrite_start_url + 'events/' +
                      session.userData.current_event_id +
                      '?expand=venue&token=' +
                      session.userData.token
                      + travel_mode)
            .then(function(response) {
                session.userData.location_destination = response.data.venue.address.localized_address_display;
                const msg = new botbuilder.Message(session)
                    .attachments([
                        new botbuilder.HeroCard(session)
                            .title('Amazing !!!')
                            .text('I find an itinerary for you, for a better experience, open it in google map')
                            .buttons([
                                botbuilder.CardAction.openUrl(session, 'https://www.google.com/maps/dir/?api=1&origin='+ session.userData.address +'&destination=' + session.userData.location_destination, "See Itinerary"),
                            ])
                    ]);
                botbuilder.Prompts.text(session, msg);
                session.endDialog();
            })
            .catch(function(error) {
                console.log("ERROR: "+ error);
            });
        }
    }
]);

function getCardsAttachments(session, response) {
    const cards = [];
    let thumbnail_url, address;
    response.data.events.forEach(function(value) {
        thumbnail_url = (typeof value.logo !== 'undefined' && value.logo) ? value.logo.url : 'https://cdn.evbstatic.com/s3-build/perm_001/aa36c3/django/images/home/banners/homepage_hero_banner_2.jpg';
        address = (typeof value.venue !== 'undefined' && value.venue) ? value.venue.address.localized_address_display :  value.start.timezone;
        if (typeof value.id !== 'undefined' && value.id) {
            cards.push(
                new botbuilder.HeroCard(session)
                    .title(truncate(value.description.text, 38))
                    .subtitle(dateFormat(value.start.utc, "dddd, mmmm dS yyyy, h:MM TT") + ", " + address)
                    .text(truncate(value.description.text, 300))
                    .images([botbuilder.CardImage.create(session, thumbnail_url)])
                    .buttons([
                        botbuilder.CardAction.openUrl(session, value.url, "read more"),
                        botbuilder.CardAction.postBack(session, `weather forecast ${JSON.stringify({id: value.id})}`, "weather forecast"),
                        botbuilder.CardAction.postBack(session, `itinerary ${JSON.stringify({id: value.id})}`, "find an itinerary")
                    ])
            );
        }
    })
    return cards;
}