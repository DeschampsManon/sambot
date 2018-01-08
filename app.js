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

let categories_hash = {};
bot.dialog('UpdateEventPreferences', [
    function (session) {
        botbuilder.Prompts.text(session, 'Have you an idea of event behind your head ? Just say "no matter" if you want to skip ');
    }, function (session, results) {
        if (results.response) {
            session.userData.event_human_keyword = results.response;
            session.userData.event_keyword = results.response.replace(/ /g,"_");
            botbuilder.Prompts.text(session, 'Where would you like to go ?  Just say "no matter" if you want to skip ');
        }
    },
    function (session, results) {
        if (results.response) {
            session.userData.event_human_location = results.response;
            session.userData.event_location = results.response.replace(/ /g,"_");
            axios.get(eventbrite_start_url + 'categories/?expand=venue&token=' +  session.userData.token)
                .then(function(response) {
                    response.data.categories.forEach(function(value){
                        categories_hash[value.name] = {id: value.id}
                    });
                    categories_hash['No Matter'] = {id: 'nil'}
                    botbuilder.Prompts.choice(session, "Which kind of event could interest you ?", categories_hash, { listStyle: botbuilder.ListStyle.button });
                })
                .catch(function(error) {
                    console.log("ERROR: " + error);
                });
        }
    }, function (session, results) {
        if (results.response.entity) {
            console.log(categories_hash)
            session.userData.event_human_category = results.response.entity;
            session.userData.event_category = categories_hash[results.response.entity].id;
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
            show_user_preferences(session);
            session.beginDialog('EventsSuggestions');
        }
    }
]).cancelAction('cancelAction', 'Ok, cancel.', {
    matches: /^nevermind$|^cancel$/i,
    confirmPrompt: "Are you sure?"
}).triggerAction({
    matches: /^(update preferences)/i
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
                    const msg = new botbuilder.Message(session);
                    msg.attachmentLayout(botbuilder.AttachmentLayout.carousel)
                    const card = [];
                    response.data.events.forEach(function(value){
                        var thumbnail_url, address;
                        if ( typeof value.logo !== 'undefined' && value.logo )
                        {
                            thumbnail_url = value.logo.url
                        }
                        else
                        {
                            thumbnail_url = 'https://cdn.evbstatic.com/s3-build/perm_001/aa36c3/django/images/home/banners/homepage_hero_banner_2.jpg'
                        }
                        if ( typeof value.venue !== 'undefined' && value.venue )
                        {
                            address = value.venue.address.localized_address_display
                        }
                        else {
                            address = value.start.timezone
                        }
                        if ( typeof value.id !== 'undefined' && value.id ) {
                            card.push(
                                new botbuilder.HeroCard(session)
                                    .title(truncate(value.description.text, 38))
                                    .subtitle(dateFormat(value.start.utc, "dddd, mmmm dS yyyy, h:MM TT") +", "+ address )
                                    .text(truncate(value.description.text, 300))
                                    .images([botbuilder.CardImage.create(session, thumbnail_url)])
                                    .buttons([
                                        botbuilder.CardAction.openUrl(session, value.url, "read more"),
                                        botbuilder.CardAction.postBack(session, `weather forecast ${JSON.stringify({id: value.id})}`, "weather forecast"),
                                        botbuilder.CardAction.postBack(session, `itinerary ${JSON.stringify({id: value.id})}`, "find an itinerary")
                                    ])
                            );
                        }
                    });
                    msg.attachments(card);
                    session.endDialog(msg);
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
                                image_url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ-TkX6gNHIyU4eSA8_o1l5s3Y5pQcSYLYKgtUowR04IqMqwjE8XQ'
                                break;
                            case 'clear-night':
                                image_url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTamRtyjck_wRwQyz3tXa_9O16B--GomziHIIzL6bQfw1jvSub5'
                                break;
                            case 'rain':
                                image_url = 'data:image/jpeg;base64,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'
                                break;
                            case 'snow':
                                image_url = 'data:image/jpeg;base64,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'
                                break;
                            case 'sleet':
                                image_url = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxMSEhUREBIVEBAVEBAPEBUVEBUPFRUQFREWFhUXFRUYHSggGBslHRUVITIhJSkrLi4uFx8zODMsNygtLi8BCgoKDg0OFxAQGi0dHx0tMC0tLSstLS0tLSstLS0tLS0tLS0tLS0tKystLS0tLS0tLS0tLS0tLS0tLS0tKy0tLf/AABEIAOEA4QMBIgACEQEDEQH/xAAcAAEAAQUBAQAAAAAAAAAAAAAABAIDBQYHAQj/xAA8EAACAgIAAwYEBAQEBQUAAAABAgADBBEFEiEGEyIxQVEHFGFxIzKBkaGxwdEzQlJyFVNi4fBjc4KDkv/EABgBAQEBAQEAAAAAAAAAAAAAAAABAgME/8QAHhEBAQEBAAIDAQEAAAAAAAAAAAERAhIhAxNBMVH/2gAMAwEAAhEDEQA/AOGxEQEREBERAREQEREBERAREy/ZrgFubcKqgddC7a6KP7wMdi4r2sErRnY+QUEmb1wT4UZl4DWaqB101zHX9J2nsR2AoxKx4BzkDZI2SfqZu1dSr0AAhHCqPgf08Vrk/YSJn/BNwPw7jv8A6l2P4T6DgiUfIfaDsLmYmy9ZsQf5kBbp7keYmsz7XzOHJYNED9pxX4m/DIaa/FUK/VmUdA3/AHg1xKJU6EEgggg6II0QfqJTIpERAREQEREBERAREQEREBET1VJ6AbP7wPIkkYFut90+v9jf2lzh3C7b7RTWhNh9CCND3PsIENVJOgNn0A6zYuE9h83I0UpKqfIueQft5/wnY+wHwxrpCvaA9ugSxHkfoPSdQxeHV1jQUSpr5qX4SZ2vNP4/2mM4n8Oc+kEmoWAefI2zr7HX8J9ZBR7CU2UK3RlB/SRXxUMGzvBUUYWMwUKVIOydeU+mfhh2QXDx15lHORzMfdj5zY8nslivYtrVKXQ8yEgbB9wf1MyyqANDyECotPQJ5uUmyVFzcB5Z545ow1I3I2ZUHUq3tKuaW7bIkS184/F3sv3FvfoulJ0/39DObz6m7e8D+bx3QDxMjAfRtdDOB3fD7OXe6gdezS2HNarEl5/DLqDq6tkP1HT95EmWiIiAiIgIiICIiAiJVWhJAHmSAPuYGZ7LdnLM2zkTwoNc7a8voPrO89kvhrRUoPIN+rMOYkzz4admVooQEddBmOupPrOhi7Q0vSazGN1BTsxQBrlnlPZmhG50QBvflG/3kw2fWUi4+8ZTYv8AOF6LPEbZ6yyp3Lw6QJAM93LHPPeaTF1dZpaLS3ZZLRtlw1dd5GNsqLyLcdSyM2pAtlYskAWSoWy4mp3eSzZZLHeyk2S4lqZjMN+Lyktqam8wp/SYlXkqppLFlYftP2PpvrYcgIIOxrc+ce3PZZsK3ps1MTyn2PtPqqy7Q+k518TeELfQ+h15SwPsw6gyZsXcr5ziekTyYdCIiAiIgIiIGz9iuyjZr7ba0qdEjzY+wnc+zvw0xkCt3SjWiCVBbp7kzWfhfWiYtZGuoDN9yes6TXxcsNKdanSc+vTlevftkFxhUOUfaOaRFyCfM7nl9uh0lxNV2ZEpS7cx22J0AZmsDC6bMXInO17TuX+RzJdaAeQlzU566yMea3lPekfmEyRlq1AY0xi7rZH7+S8vE9VmItVgZ0mVz62JvfyhrNzGu7CEyZrxY8kwxzSwL5V30YarNkd5LLvLDWS4mp62yVVbMKL5cXKjxPJlr7ukw+VSLAVbqCCP0lN+WdSPTkbMs5S9NYPwoxOp5S2yTsu3qfp0mD458Kq9E0Fq29OvMCfrudgxLdjrLOYoImPGOnlf7r5U4vwuzGsNdq6I8j6Ee4kKdu+KPAltxzYB4024P28xOIzl1Mrrz1sIiJGiIiB0T4a9pVrHy1p11/DJPnv0nUse09CvXflPmoGd1+DFNz4+7izAvuosSTyfc/Xc6c9fjl3x+ujYFLMBvzmVrwR6y9j1hRoS8GElurzzIsriqPSXxHNPZltWJ7KQZ4TIoxlstDGW2MrNekyjlX2H7TwmU80qatZOKjemjNe4hiFTsTZ5CzMYnprzm+bjHU1qqZEui+ZpezoPXYH6S3kdnyB4TudPPlz8OmIN8ttkS3nYjIfI/aQBYZqRztTzfPRdII3KhuXE1ftt30EvYqyzVTMhQmvOKROqbQli7I9JZvyJFD+pmcb1d4nhC6pqz5MpH7ifP3a7sy+FZr81RPhb+hn0Gcnpqc/+LLL8t11vmXX33Ofc9Ovx3LjjkRE4u5Nh7L9kr8xhygpVvq5Hn/t95D7NcJOVkJUPyk7f/aPOfSHAeH141agADQAAmuedY66xqvAPhDRoGxS/uWJ1+06TwnhFeKgSsBVUaAA0BK6c0ke0r7zc1jOpIeVBpHVp61mpMXUoPKw8hB5cV4xdSueC0j88qDyYuq2MtsZQ1sp55cTVRMpnm4VpUSE6Si5xKGskW22SQtSe+la3zHGyBZNeLPkq4tSHXfqJqltIVuo85s+Rb0mucSsAXmPp5zfPqOffuvBUvvKLdDymJHHaP+av/wChMdxLtriVDrarH2Xxn9hL5p4VsYyyPISiy52nNLPieec6p8Hp4tNI2d8TLWGqqwp92O9ftM/ZGvqrqAZpVza6sdTjGJ29y0J5mFg2T1Gv06SjifbfJuBUEVg+fL5/vJ9jU+Kuhce7fUUOaxt3A68o2AfYn3nMu03aOzMfbeFB+Vf6mYVjvqep8z955Od6tdeeZCIiZadD+D9IN1jnzAUf1nWcjI2wHoJx34UZwTIas9OZQR+nn/SdWvPXc7/F/Hm+b+tnxH6SajTBcOydiZaqyLDmpimWrX6z1WkbLs6ySNWpKPLqvMfXbLnfRhqbzy3kX8o3LIslrLO1MYWleXuSltmtLfynrJ1WVNXlidsu92paGTIRu3I5yOsk5W9Msbty0zyGuRPHulxPJK55SXkNb5690uJq7kW9JiDYCSD5S9k5HSYtrZZEtaF8R+z6qfmK1Gj0fQ/Yzndtc7X2w02Jbv8A5bEfcDYnHbE/ece5lej47sYxxKZIarxAa5tsBodN9fIGdJy+ytQwwlC8uT8zVlJi3vScgoqFbkUq3jQ+BgCAeh6dZjG9a9wTsJbfQ9y/ihsbvcbuWDA399WjVW7HhYB9kdPfegZrPE8I0WvSXSwoxQtW3OhI8+VtdfadYQYtL8SqqtuwFGMPmKlUupBev8WnqOVtMyFT/rBB0DIGHwCg34uQtaYmF8lzBrnXx5FjWcnMSRztylCQPKXE8nLImZ7U8NXHuFaLYq8gPNYUJsPM23UISFU+QGz5TDTN9LLpERCpHD8xqbFtQ6ZWBH19wZ27s/x6vLqDK2n0OZd9QfacJknBzrKW56nKN9PX7j1muevFjvidR9DY9xUzLYuaZxHh/wASL0GrK1s+oJQ/1kqz4pW/5KVH3cn+AE6/ZHKfFY7zTfuY7MyfFMD2R7TLlVLYOh14l9m9Zkc87OxNc5WOtiWmVLqXzBLaRJFeTNeLHkziXSvvJikyJdF8zjXkqysXfUSMlTCSe/lLZH1lRS5KjZmPvyusyXOGGjMNxOjXUdTLEur/AM9PH4hNeex5XTU7TWRnaztOaCfOe5HEAPWYU4/L05xv7yxcUQFrbAqjqSTM7GsrLfOAy0G2ekwtXajB10uX9TqYnjPxAprUrjjvH8gfJR9dzN7jc+PpM7bcQAq7oHxN0P29ZzDIv0evnPM3i9trM9jbZv2A9hIJO5w6616eeci4zliB5dQB6fxnQ+yvCLKAVsxOS1vEmerV5C1euyjtyDW/zAqfvOcKf1my3dqOfF+WZeRTk1O1daBKhQinoBvZYsdkn/SOsQ638dDxeKV0/N1ZjHiV9GP3l13cInLWba9VrvfenZD+LQ8AA9TLGVh2PSHs5uOJaosx6VqrxzQln5WZtl69j0Qa8P5pf7P5mTkJk31CnBS2gnFSzXPfYLalNtpI6qfCnXp49D1M1du13y+dTY+O2G9GLZg5NdXkCXtYNUCeg269CdDXSdPUcvdahx7hdmPYEtVa2Ze8VBYLORSzAKTs6PQ9D/WY2ZHjnFTk2C10rR+UK5rr7rvGBJ7x1B1znY3rQ6D7zHTlXafz2RESKREQETZOxHZVuIWWop5Vrx7LN/8AqcpFS/q38AZrtiFSVYaYEgg+hB0RAy3Zvj9mHZzp1U6519x7j6zsHBO1VGUo04Deqk6IP2nB5UjkHYJB9wdTXPVjPXEr6GdAeoaeLWPVgP1nCquPZKjS32Af7t/zlvI4zkP0e6xh7c5A/hN/a5fS70WYeR3PPnmE4hw7tHlUa5LW5fQN41OvTr/SZuv4i5GvFXWx9+qzU+WfqX4b+OqDNYxbnLWOe1goHU7OpyfI+IWSRpFRProtNd4hxa687usZ/pvQ/YdJL8v+HPw/67JT29xHJUWgaOuu1B+x9Za4l26xa12HDn0C+IzigEn0cIsfHtyVA7umyqu4b8Sm3m5Dy+21I+8x510+uN/o+I1TkDuH5iQFA5Tsk6A85G7Qdvba2alKDTYpKuLNbVvsD/WQ+y1Axu6r4hjg4uYaL8bIVQXrtB8BVx5jrpkP3995Pt3QMnMyMPAx+8t75snNyHQFgyg6RGP+HWo9R1Yn26R5Wr4cxz/J4tdY/ePaxf35iNfQASzfl2P+d2b7sTL6cLc47ZW1FS2rR1Oi1jKW0o9eg3IRGuh6HyMw28iIgJsHDOyGRfQcisKa9gb5hoDxc5dvJOULvr7jUyXw+FDd5VZS99zpciCoEWKllJrdmZmFZQc29EbBAIM3GvFrNFvdJRfQnyi3Wra1NJNfNzHKrB8RXanprm2AdgSyJbjjkTofbGnGrxz3aFhZdfdRfy/gNzuDy1BG6MqhV2w1pegnPIswl1PxOMW1rYittbaRjtzeLVQdXAXf5eqjykO65nYs7FmPmSSSfuTKVG5cNMC1E9InkikREBERA798IOBd1gizXjvJtJ/6fJB+385zL4qcG+Wz30NJaBcv3PRtfqJs3YL4tJh4y42TQ9vdjlqasqDyegYH295pXbrtS3Esk3lO7QKEqTe9ID6n3M6W8+LlzOvL212Iic3UlSISQANkkAD3J8pTNv8AhhwX5nNUsN11fit6jY/KP3/lLJqW42rtl2HWjhGO6D8ekc95Hr3mi37dP2nJp9UcQoFtbVv1V1KMPoRqfMnGeHtj32UP512Mn3APQ/qNH9ZeozzUKIiZbXcU+NfFyeNfF/p6/m6e3nOrX9pcCyqzFybjmZOQq49uTRiGssFYNWzqD+MwYDR1v95yatOYhdgbIGydAbPqfQTpHZfEzsL8NcJciu0lBk4zp3oB8+XJUnkX76+8sSszxWnJwa8KsoMzD5BRkqyNyD8ctS5U+KmwK403Ty17SbS+TkZ+ZTRWMfEQZCM4Uhbcp0ChrX83Yb6KPLp08piFXH4XfXkJfflW5T8qp3wNfR+R++cf4uiSNe4kzj4x+J5tuNfdbiWYhdgRYDQak6s4U/4b9erf2m5HO1i6OKYGHSeH8zLkVWtZ392KWUZDgKWFTHoQoADEeXX1nOuMMTfYTb8wS7E26I5+v5tHynSu0uDnXp8nXgl6UG1y8m1L2NbdQyZLEKF9dAnz8pzHPxTVY9TMrFGKlkcWIdeqsOhEnS8XUeIiYdGx9lc/GqV/mK1sYB7KiS1ZDrWSgFiMG6sFGvqTOgYuecih8rnyWVPlC9lPgRCnM1vd1k7tA349eY99Gcck/G4zfWnIlrqNoy6dgUKFiOQ78H5j5TXPWMdc63LtXx/CyKbXCK2W119aPp3/AAVcd0QjNy17Q65lHmp6CaPhUBz1MjSXgWkHp6yW7VkyekuzEAI6ektvV0mR1035yw9I1KaxVlfWWSJPsX9JCsmVUREQpERAREQESRgYb3WJVUOax2CqPcmUZWO1btW40ysUYfUHRgWp2/4G8MHytl3+Z7yn2VFGv4sZxCdO+D/bunC5sXLJSh37xLNFglhAB5gOujodZviyX25/JLefTuLYnScG+NvCxVl12jp3tR5vq1Z1v9iB+k7bl9tOG11942djldb8Nq2MfoqKSSfoBPnb4jdqv+I5ZtQFaUHd0g+fKD1Y+xPt9p07sxz+PmzpqsRE4PQqQjY2NjY2N62PUbm419qVGFlVVKmMHFVNVSA8zBiTbZY2vEeVQvn/AJppkSy4lmukcD4yjHBowaPmM1aq6zYy7WkGwvaUU9ObxHbHoNTPdoOOV0cQvr4lQa2aq+vFyVXq9FiEKtgH51B6BvMa0fKc07P9oXxVZE0q2WVG1wv4ndK22QN6Kfb6TIdre1xymvqUc+K+ScjH7xPxKt/mCHfhDeo8pvy9Ofh7ZHgXa5aeF/LOKrymYT8vanMtuNYmzynXhKuCd7H5ppfEbUe12qTuqi7FE5uflUnoN+sjxMW66SYRL+FiPdYtVSl7HYIijzLHyAlY4dabHqFbG1OfvEClmXk/PsD20dyKr4Vwu3Jc10LzuK7LSOYL4EUsx2SPICQp2PsFk4ecwsATDz6sO/HtUDlquqakoLAPQr0J/wDDNK7SX47KnD+G098lTM738m7b7OXxsNdRWAP4S4mtRmU4LrZ3rX1kXF4fbatj1oXSpA9pHkiE6BP6yOrEeUDZbGAIUDzll06HrMVVmtsbP0/SZMWpy+fSVMRrPPUhZQnt9/Xwnp6SMzbkqvIiJFIiICIiB0r4I8I58l8tx4KV5U+trf2H85C+MXB+6zO/QarvXn/+wdGH8jOp/DrgXy+FUmtOy97Z/vfr/wBpC+K3Au+wbGA8dX46/wDx/MP1G518Ljj9k8nz5EROTs93PIiAiScHAsubkqQuxWxgB6iutrH17kKpOptHYXglNl2P82rV97kUtjO682PcFsHeUuNbDMNgH36EddwNOiZ/jnCEUp8oHtq5xjm8jlruySeopHoo8hsmYbLxmrdkcaZWZG9dMp0Rv6GBZiIgIlQUy8aOkDo3YThVeXXSDhW419LiyjPrQtWXV+dTerEbG9DYPkPSZi7g1mN2hrzEQnEvyHIsXxILLamVwxXyPOSevvOccJysnJNeGczuKQCqd7c1VSrveunmdk6E3pL/APgKEVJkZjMATY34eFvz2iqSSfqSJqM1c7J34eVlO7AYWeuPl1ZCqn4FoNbI9igfkI8yJF7PcRxkrzaOH1FkTh2QWyXT8a69uVK+Uf5E2x0vn5TMdjeE0ZrtxCumzBteq+u0MOeixra2BsqJIPTeyPL+cxJ4tXwO35fGwrLXflW6+4lGuA8u4C7AG+o8/Tp6zWM7+L3ZHscw4demUHpa+yqx61Aa58arxKqqT4SX9/SaF2uRVsVExGwlRSqhwedxv8zk+Z+027j3ZnvkPEUyLsJz4imc/dsf/atU7I9ACB+k5/xDiV13KLrWt5AVTmbm0CdnRMnXqHPu6hyoOfLfSUxMOhERAREQEREBERA+pfh12hozcWtkdRaqLXdXsBlcDXl6g685C+K3aKjFw7Ky6tfajVVVggtsjRYj0UT5rovZDzIzI3urFT+4i65nPM7Fm9SxLH9zOn2Vy+qLcRE5upERA334c8dNWqase3NvLtYlJNVdSnWu8DFWfm0fTQ0T5zauCqq2YuLg2V2rVf3mTi2OtzVq1wcsjgAO1ZBPMuiNdRNJ7D4WNboXsabCzd3bTkMl45VLHdZBXkABJPTym58L4ob/AJG4WLiVPkpWwJ7zIyOS9VqR2HV9nqT0UAzfMc+ulqo75K72qvz6MlsinAqsWlB4FCV8xBHhCk8i7J5vMdZo3bjiYutANdmO6M4sobuylbHW+RkUE7O98w39ZvlGWBRSl1/f15OYcRcylxTkJTyqa+YkHqCbAUYe2iNbmkdvsDHpsVcXTAPaju2Q117WIQGFyEAIQd+Q6+8vU9JzfbVJfw02wBG5Yl7ErLMADozm6su+OOmtdJHsrHWT6qSBojR9/OWrPL+c0yzPZzgGHmqtWsmjIVSLLgEtx973zMCQV6a6bHlNs7OCrh2UnDjfZnXXOqMh/Dx6az13yHm5m5euvL7eujYnGHApptcjESxTYqLosnPzMG11b1Erxe0y18UbiDq1iiy560HhJBRq6wSfy+EjZ0fLympkYu3W29k2zc/MuyHJ+UFWZTQWIrqHOjKgQeR0NbI+s97F8VzMM5WPnVtccXEfMpSwg+GtlDmu3R6FX6EbnvYL5viFzZD8lGFXj5GPQg/DpVnqKgVr68o6lvpMRj9qMnA73h3FKu9Q49+MlnQ2112oV3W/+eo9On9tTX8ys5uxlqextHFQ2fXnZL08xDUvWLshbdcxqRiwXyII6H9fOc/7VVYqWCvEqyKuQFbvmSveM++h5V6L0k3s52gWnCzMZ3dHc0X4jJva5Nb9eo8tr037CYzj/aG/NNbZLix607tW5QrEb34yPzH6mYtljfMsrExETDoREQEREBERAREQEREBERAREQK67Cp2pKnRGwddCCCP1BI/WbH2I7QV4l9dlibYXVDvWPeCnH5x3vd16/Ow2Ob0BOuvWazEsuJZrMdoOMrkWC2uv5dzp7gjkVveD/iqmvwyfUbPWYq20sxZiWYkliTsknzJMoiLdJMJexbuRubW5ZiRWcbiCvy9de8vkkjeproMmLxBuXR6n3mtZxdtuAPXp08pBus2ZS7knZ85TI03vgfbgtcgyStONVhZGPVXUhFYsekoG5RvbE+Z+s1/ifaW3Ixqsa8JZ3JPdWlT3wrI/wAMvvqv3mEiXyrM5kIiJloiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiB//9k='
                                break;
                            case 'wind':
                                image_url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTFBhMdLMxywZXb6n6zoiIiOCBt4dD5BTU8mgUZc7HLp5mi3bygnA'
                                break;
                            case 'fog':
                                image_url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQvxxXAL3X7U8xAzxlRZI9wphfKGPFOJeWOmYX_WQYVX5vUpNBi'
                                break;
                            case 'cloudy':
                                image_url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQVAPUzy4SOaWP7m6XRfDWi6oiHi5su2SxkR6XS5l_L_Nj0h-pREg
                                break;
                            case 'partly-cloudy-day':
                                image_url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQVAPUzy4SOaWP7m6XRfDWi6oiHi5su2SxkR6XS5l_L_Nj0h-pREg'
                                break;
                            case 'partly-cloudy-night':
                                image_url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQVAPUzy4SOaWP7m6XRfDWi6oiHi5su2SxkR6XS5l_L_Nj0h-pREg''
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
            console.log(results.response)
            session.userData.address = results.response;
            botbuilder.Prompts.text(session, 'May have I the origin city too please ?');
        }
    }, function (session, results) {
        if (results.response) {
            session.userData.city = results.response;
            botbuilder.Prompts.text(session, 'Thanks, and to finish I need the origin postal code ?');
        }
    }, function (session, results) {
        if (results.response) {
            session.userData.postal_code = results.response;
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
        if (session.userData.address && session.userData.city && session.userData.postal_code) {
            session.send('I already saved an origin position : ' + session.userData.address + ', '+ session.userData.city + ' ' + session.userData.postal_code);
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
            session.userData.location_origin = session.userData.address + '+' +
                                               session.userData.city + '+' +
                                               session.userData.postal_code;

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
                                botbuilder.CardAction.openUrl(session, 'https://www.google.com/maps/dir/?api=1&origin='+ session.userData.location_origin +'&destination=' + session.userData.location_destination, "See Itinerary"),
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