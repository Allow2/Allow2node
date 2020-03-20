var allow2 = require("allow2")

//
// start by "pairing" the device or service to the allow2 platform
//
// For this, you need a free Allow2 account with an email/password.
// https://app.allow2.com
//
let email = "parent@email.address.com";         // The parent logs in to Allow2 with this email address
let password = "parentpassword";                // and this password

//
// **** Once you have paired the device,
// update these creds and you can interact with Allow2
//
let pairing = {
//    pairId: 123,
//    token: "AAAAAAAAA",
//    userId: 234,
//    childId: 862                  // MANDATORY! = the child that is using the device or app
};

//
// this device token comes from the developer portal to describe your device
// the one here is valid and you can use it for testing, or replace with your own
//
let deviceToken = "B0hNax6VCFi9vphu";

if (!pairing.token) {
    return allow2.pair({
        user: email,
        pass: password,
        deviceToken: deviceToken,
        deviceName: 'Runkit Example Device'
    }, function(err, response){
        if (err) { return console.log("Error: ", err, response); }
        if (response.status != 'success') { return console.log("Error: ", response.message) };

        console.log('pairing complete, please use:\n',
            'let pairing = {',
            '    pairId: ' + response.pairId + ',',
            '    token: "' + response.token + '",',
            '    userId: ' + response.userId + '',
            '}'
        );

        if (response.children.length < 1) {
            console.log('Warning: You have no children on this parent account, you will be unable to test usage as a child is mandatory.\nSuggest you add at least 1 child and pair again.');
        }
        console.log('and pick a child id out of:', response.children);
    });
}


if (!pairing.childId) {
    return allow2.status({
        userId: pairing.userId,
        pairId: pairing.pairId,
        pairToken: pairing.token,
        deviceToken: deviceToken,
    }, function(err, result) {
        if (err) { return console.log("Error: ", err, response); }
        console.log('result from Allow2 status:\n', result);
        console.log('use one child id to then call the check routine to check and log usage.')
    })
}

//
// once the device is paired, AND you have a childId to record usage,
// you call "check" to check if access is currently allowed.
// logging the usage is optional - otherwise it just returns the ability to use the activity at this time.
//
allow2.check({
    userId: pairing.userId,
    pairId: pairing.pairId,
    pairToken: pairing.token,
    deviceToken: deviceToken,
    tz: 'Australia/Sydney',                    // note: timezone is crucial to correctly calculate allowed times and day types
    childId: pairing.childId,       // MANDATORY!
    activities: [
        { id: 1, log: true },		    // 1 = Internet
        { id: 2, log: true },           // 2 = Conputer
        { id: 3, log: true },           // 3 = Gaming
        { id: 8, log: true }            // 8 = Screen Time
    ],
    log: true				    // note: if set, record the usage (log it) and deduct quota, otherwise it only checks the access is permitted.
}, function(err, result) {
    console.log('result from Allow2 check:', result);
});

