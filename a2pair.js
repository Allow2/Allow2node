#!/usr/bin/env node
var co = require('co');
var prompt = require('co-prompt');
var program = require('commander');
var request = require('request');
var allow2 = require('./index.js');

program
  .arguments('<device token> <device name>')
  .option('-u, --username <username>', 'The allow2 parent account user to authenticate as')
  .option('-p, --password <password>', 'The allow2 parent account user\'s password')
  .option('-s, --staging', 'Use the staging server, not production')
  .action(pair)
  .parse(process.argv);

function pair(deviceToken, deviceName) {
    /*co(function *() {
        var username = yield prompt('username: ');
        var password = yield prompt.password('password: ');
        console.log('user: %s pass: %s file: %s', username, password, deviceName);
    });*/

    //console.log('user: %s pass: %s file: %s', program.username, program.password, deviceName);
    allow2.pair({
        user: program.username,
        pass: program.password,
	    staging: program.staging,
        deviceToken: deviceToken,
        deviceName: deviceName
    }, function(err, response){
        console.log(err, response);
    });
}
