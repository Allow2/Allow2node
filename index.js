/********************
 * Allow 2 web-based cloud api node module
 *
 * This is an example of how to call the web api. It is copyright Allow2, but opensourced to encourage porting and adoption by the community.
 */

var request = require('request');
var async = require('async');

require('ssl-root-cas/latest')
    .inject()
    .addFile('./certs/COMODORSADomainValidationSecureServerCA.crt')
    .addFile('./certs/COMODORSAAddTrustCA.crt')
    .addFile('./certs/AddTrustExternalCARoot.crt');

const apiUrl = 'https://app.allow2.com:9443';

var exports = {};

/**
 * Set up a device pairing with the allow2 service.
 * Device pairings are used for multiple devices of the same type (wemo light switches, playstation consoles, PC games, etc.
 * Services use the Allow2 service differently as they tend to have one real "instance" - ie: facebook, twitter, etc.
 *
 * @name pair
 * @static
 * @param {Object} params
 * @param callback
 * @example
 *
 * allow2.pair({
 *     user: "fred@gmail.com",
 *     pass: "my super secret password",
 *     deviceToken: "346-34269hcubi-187gigi8g-14i3ugkug",
 *     deviceName: "Fred's iPhone"
 * }, function(err, result) {
 *     console.log(result);
 * });
 */
exports.pair = function pair(params, callback) {
    //console.log('user: %s pass: %s file: %s', program.username, program.password, deviceName);
    request({
        url: apiUrl + '/api/pairDevice',
        method: 'POST',
        json: true,
        body: {
            user: params.user,
            pass: params.pass,
            deviceToken: params.deviceToken,
            name: params.deviceName
        }
    }, function(err, httpResponse, body) {
        if (err) {
            return callback(err);
        }
        return callback(null, body);
    });
};

/**
 * Check routine, call this to get an immediate response on accessibility and record usage. This is fail-resistant as it uses a cached last value
 * and can be called as often as you like, but it will rate-limit calls to the web server regardless.
 * In the event it cannot connect, it will allow grace access blah blah...
 *
 * @name check
 * @static
 * @param {Object} params - An object containing the userid and pairid for checking/logging and various settings
 * @param callback
 * @example
 *
 * allow2.check({
 *     userId: 1,
 *     pairToken: "98hbieg87-ilulieugil-dilufkucy",
 *     deviceToken: "iug893-kjg-fiug23",
 *     tz: 'Australia/Brisbane',                    // note, timezone is crucial to correctly calculate allowed times and day types
 *     childId: 10,
 *     activities: [ 1, 2 ],
 *     log: true
 * }, function(err, result) {
 *     console.log(result);
 * });
 */
exports.check = function pair(params, callback) {
    // first simple version will always wait for a response
    // if still valid in cache, don't check again
    /*async.auto({
        cached:
    })*/

    request({
        url: apiUrl + '/serviceapi/check',
        method: 'POST',
        json: true,
        body: {
            userId: params.userId,
            pairId: params.pairId,
            deviceToken: params.deviceToken,
            tz: params.tz,
            childId: params.childId,
            activities: params.activities,
            log: (params.log == undefined ? true : params.log)
        }
    }, function(err, httpResponse, body) {
        if (err) {
            return callback(err);
        }
        return callback(null, body);
    });
};

module.exports = exports;