require('dotenv').config({path: 'config.env'});

const restify = require('restify');
const botbuilder = require('botbuilder');
const axios = require('axios');
const truncate = require('truncate');
const dateFormat = require('dateformat');
const mysql = require('mysql');

// Setup restify server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function(){
    console.log('%s bot started at %s', server.name, server.url);
});

// Create chat connector
const connector = new botbuilder.ChatConnector({
    appId: process.env.APP_ID,
    appPassword: process.env.APP_SECRET
});

const database_connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

// Listening for user input
server.post('/api/messages', connector.listen());

var bot = new botbuilder.UniversalBot(connector, function(session){
    session.send("Hmmm.. I didn't understand that. Can you say it differently");
});

const luisEndpoint = process.env.LUIS_ENDPOINT;
var recognizer = new botbuilder.LuisRecognizer(luisEndpoint);
bot.recognizer(recognizer);

bot.dialog('Login', [
    function(session) { 
        var msg = new botbuilder.Message(session) 
        .attachments([ 
            new botbuilder.SigninCard(session) 
                .text("Authorization needed") 
                .button("Login", "https://www.eventbrite.com/oauth/authorize?response_type=code&client_id="+process.env.EVENTBRITE_CLIENT_ID) 
        ]); 
        botbuilder.Prompts.text(session, msg);
    },
    function(session, results) {
        console.log(process.env.DB_HOST)
        console.log(process.env.DB_USER)
        console.log(process.env.DB_PASS)
        console.log(process.env.DB_NAME)
        database_connection.connect(function(err) {
            if (err) throw err;
            database_connection.query("SELECT hash FROM tokens WHERE code = '"+results.response+"'", function (err, result, fields) {
                if (err) throw err;
                console.log('a')
                if (result.length > 0) {
                    session.userData.token = result[0].hash
                    session.beginDialog('Greeting');
                } else {
                    var msg = "Your code looks to be wrong, please try with an other code";
                    session.send(msg);
                    session.replaceDialog('Login', { reprompt: true })
                }
            });
        });
    } 
]);

bot.dialog('Greeting', [
    function (session, args, next) {
        if (session.userData.token) {
            axios.get(start_url + 'users/me/?token=' + session.userData.token)
            .then(response => {
                session.send('Hi '+ response.data.name +', nice to see you');
                session.endDialog("My name is Sambot, I'm here to help you to find an idea of activity. What can I do for you ?").endDialog();
            })
            .catch(error => {
              console.log(error);
            });
        } else {
            session.beginDialog('Login');
        }
    }
]).triggerAction({
    matches: 'Greeting'
});
