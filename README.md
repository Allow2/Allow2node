# Allow2 - Free and Powerful Parental Controls for your apps and devices

[![npm package](https://nodei.co/npm/allow2.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/allow2/)

[![Build status](https://img.shields.io/travis/allow2/allow2/master.svg?style=flat-square)](https://travis-ci.org/allow2/allow2)
[![Coverage](https://img.shields.io/codecov/c/github/allow2node/allow2.svg?style=flat-square)](https://codecov.io/github/allow2/allow2?branch=master)
[![Coverage](https://img.shields.io/coveralls/allow2/allow2.svg?style=flat-square)](https://coveralls.io/r/allow2/allow2)
[![Dependency Status](https://img.shields.io/david/allow2/allow2.svg?style=flat-square)](https://david-dm.org/allow2/allow2)
[![Known Vulnerabilities](https://snyk.io/test/npm/allow2/badge.svg?style=flat-square)](https://snyk.io/test/npm/allow2)

Allow2 makes it easy to add parental controls to your apps.

1. [Why should you use Allow2?](#why-should-you-use-Allow2)
2. [Requirements](#requirements)
3. [Integration](#integration)

## Why should you use Allow2?

Parental controls are incredibly complex and difficult to get correct and for a parent, there is nothing worse than having to log in or open up yet another parental control interface on another app and reconfigure it every other day.

Allow2 solves the problem once and for all:

1. Leverage the powerful Allow2 platform completely for free (no developer licensing fees)
2. Add parental controls in a matter of hours and don't worry about implementing heaps of interfaces.
3. Show your community responsibility and support parents, this helps to bring more users to your apps.

Really, you should be able to add extensive and powerful parental controls to your apps in a matter of hours or (at most) a couple of days.

With Allow2 all you have to do to check if something can be used and record it's usage is:

```js
var allow2 = require('allow2');
allow2.check({
    userId: 1,
    pairToken: "98hbieg87-ilulieugil-dilufkucy",
    deviceToken: "iug893-kjg-fiug23",
    tz: 'Australia/Brisbane', // note, timezone is crucial to correctly calculate allowed times and day types
    childId: 10,
    activities: [ 1, 2 ],
    log: true
}, function(err, result) {
    console.log(result);
});
```

Callback:

```js
function callback(err, result) {
}

```

## Usage

#### Initialization

```js
npm install --save allow2
```
