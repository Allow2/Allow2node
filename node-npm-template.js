var allow2 = require("allow2")

//
// start by "pairing" the device or service to the allow2 platform
//
// For this, you need a free Allow2 account with an email/password.
// https://staging.allow2.com
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
// this device token comes from your developer portal to describe your device
//
let deviceToken = "jJ5GOIaJ028Ywt6K";

if (!pairing.token) {
    allow2.pair({
        user: email,
        pass: password,
        staging: true,
        deviceToken: deviceToken,
        deviceName: 'Runkit Example Device'
    }, function(err, response){
        if (err) { return console.log("Error: ", err, response) };

        console.log('pairing complete, please use:\n',
            'let pairing = {\n',
            '\tpairId: ', response.pairId, ',\n',
            '\ttoken: "', response.token, '",\n',
            '\tuserId: ', response.token, '\n',
            '}'
        );
    });
}

//
// once the device is paired, you call "check" to check if
// access is currently allowed.
// logging the usage is optional
//
allow2.check({
    userId: pairing.userId,
    pairToken: pairing.token,
    deviceToken: deviceToken,
    tz: 'Australia/Sydney',                    // note: timezone is crucial to correctly calculate allowed times and day types
    childId: pairing.childId,       // MANDATORY!
    activities: [1, 2],         // 1 = Internet, 2 = Gaming
    log: true,				    // note: if set, record the usage (log it) and deduct quota, otherwise it only checks the access is permitted.
    staging: true               // note: if set, use the staging environment, not production
}, function(err, result) {
    console.log('result from Allow2 check:', result);
});