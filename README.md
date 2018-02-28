# Allow2 - Free and Powerful Parental Controls for your apps and devices

[![npm package](https://nodei.co/npm/allow2.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/allow2/)

[![Build Status](https://img.shields.io/travis/Allow2/Allow2node/master.svg?style=flat-square)](https://travis-ci.org/Allow2/Allow2node)
[![Coverage](https://img.shields.io/codecov/c/github/allow2node/allow2.svg?style=flat-square)](https://codecov.io/github/Allow2/Allow2node?branch=master)
[![Coverage](https://img.shields.io/coveralls/allow2/allow2.svg?style=flat-square)](https://coveralls.io/r/Allow2/Allow2node)
[![Dependency Status](https://img.shields.io/david/allow2/allow2.svg?style=flat-square)](https://david-dm.org/Allow2/Allow2node)
[![Known Vulnerabilities](https://snyk.io/test/npm/allow2/badge.svg?style=flat-square)](https://snyk.io/test/npm/allow2)
[![Join the chat at https://gitter.im/Allow2/Allow2node](https://badges.gitter.im/Allow2/Allow2node.svg)](https://gitter.im/Allow2/Allow2node?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

Allow2 makes it easy to add parental controls to your apps.

1. [Why should you use Allow2?](#why-should-you-use-Allow2)
2. [Installation](#installation)
3. [Concepts](#concepts)
4. [Usage](#usage)
5. [Playing](#playing)

# Why should you use Allow2?

We remove friction and barriers to entry. Parents are scared of technology and not being able to avoid screen-time addiction or have their children gaming instead of doing homework and chores. GIVE THEM the ability to be in control which will INCREASE your user base and INCREASE your paying users.

But good parental controls are incredibly complex and difficult to get correct, and for a parent there is nothing worse than having to log in or open up yet another parental control interface on another app and reconfigure it every other day.

Allow2 solves these problems once and for all:

1. Leverage the powerful Allow2 platform completely for free (no developer licensing fees)
2. Add parental controls in a matter of hours and don't worry about implementing heaps of interfaces.
3. Show your community responsibility and support parents, this helps to bring more users to your apps.

Really, you should be able to add extensive and powerful parental controls to your apps in a matter of hours or (at most) a couple of days.

The best part is it's not only powerful, but completely free for developers and manufacturers.

# Try it out

Test Allow2 in your browser: [https://npm.runkit.com/allow2](https://npm.runkit.com/allow2)

Use the Allow2 server to create a parent account and add children: [https://app.allow2.com](https://app.allow2.com)

# Installation

```js
npm install --save allow2
```

# Concepts

The APIs for Allow2 operate in 2 modes.

## DEVICE MODE

In this first API mode, you pair the device or app with the Allow2 Service and use that pairing credential to report all usage.

This mode is used for toasters, lights, routers, gaming consoles, apps, etc. Things that are typically owned by one account or family.

To use this mode, you pair the device/app FIRST and you supply the pairing credentials to the "check" call.


## SERVICE MODE

Inthis second API mode, you instead typically only install it once, and it is for service-based systems, social media platforms, web sites, etc. These are not owned by any one family or account, but are used by potentially thousands of people that may not be related (Facebook, Twitter, www.google.com, youtube, etc).

To use this mode, you create a key/secret pair on the Allow2 Developer portal and supply the serviceID and Secret Key to the "check" call.


# Usage

There are essentially 2 steps to usage:

1. pair with the platform (see the example)
2. use the "check" routine to check permissions and log usage.

With Allow2 all you have to do to check if something can be used and record it's usage is:

```js
var allow2 = require('allow2');
allow2.check({
    userId: 1,
    pairToken: "98hbieg87-ilulieugil-dilufkucy",
    deviceToken: "iug893-kjg-fiug23",
    tz: 'Australia/Brisbane', // note, timezone is crucial to correctly calculate allowed times and day types
    childId: 10,
    activities: [
        { id: 1, log: true },		    // 1 = Internet
        { id: 2, log: true },           // 2 = Conputer
        { id: 3, log: true },           // 3 = Gaming
        { id: 8, log: true }            // 8 = Screen Time - see all "activities" at https://developer.allow2.com
    ],
    log: true                   // use this to say you want usage recorded (logged) as well as checked
    //, staging: true           // specify staging environment (BETA - use at your OWN risk)
}, function(err, result) {
    ... // this is the callback with results of the check
});
```

Callback:

```js
function callback(err, result) {
    // result = { allowed: true,
            activities: { '7': [Object], ... },
            dayTypes: { today: [Object], tomorrow: [Object] }
    // },
    if (err) {
        // can look into the err object to determine what action to take, do you allow usage?
        // (Children may deliberately kill internet to get free use), or do you require access?
        // Or do you give a grace period and cache the last response while offline?
        return;
    }
    // result.allowed: true/false  // this is the macro feedback on approved/denied.
    // you can dig in to the result.activities object to see the restrictions and bans/etc on each activity,
    // determine when times will run out or next be available and how much quota is remaining for each activity.
    
    // result.dayTypes provides details on what day type it is today and tomorrow.
}

```

# Playing

The best way to 'play' with the sdk and get familiar with it is via the runkit:
https://npm.runkit.com/allow2
