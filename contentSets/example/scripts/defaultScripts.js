"use strict";
/* jslint vars: true, plusplus: true */

//
//  defaultScripts.js
//  examples
//
//  Copyright 2014 High Fidelity, Inc.
//
//  Distributed under the Apache License, Version 2.0.
//  See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html
//

var DEFAULT_SCRIPTS_COMBINED = [
    "system/request-service.js",
    "system/progress.js",
    "system/away.js",
    "system/audio.js",
    "system/hmd.js",
    "system/menu.js",
    "system/bubble.js",
    "system/snapshot.js",
    "system/pal.js",
    "system/avatarapp.js",
    "system/makeUserConnection.js",
    "system/tablet-goto.js",
    "system/marketplaces/marketplaces.js",
    "system/notifications.js",
    "system/commerce/wallet.js",
    "system/edit.js",
    "system/dialTone.js",
    "system/firstPersonHMD.js",
    "system/tablet-ui/tabletUI.js",
    "system/emote.js",
    "system/miniTablet.js",
    "system/audioMuteOverlay.js"
];
var DEFAULT_SCRIPTS_SEPARATE = [
    "system/controllers/controllerScripts.js",
    "https://hifi-content.s3.amazonaws.com/Experiences/Releases/marketPlaceItems/appreciate/v1.5/appResources/appData/appreciate_app.js"
];

// add a menu item for debugging
var MENU_CATEGORY = "Developer > Scripting";
var MENU_ITEM = "Debug defaultScripts.js";

var SETTINGS_KEY = '_debugDefaultScriptsIsChecked';
var previousSetting = Settings.getValue(SETTINGS_KEY);

if (previousSetting === '' || previousSetting === false || previousSetting === 'false') {
    previousSetting = false;
}

if (previousSetting === true || previousSetting === 'true') {
    previousSetting = true;
}

if (Menu.menuExists(MENU_CATEGORY) && !Menu.menuItemExists(MENU_CATEGORY, MENU_ITEM)) {
    Menu.addMenuItem({
        menuName: MENU_CATEGORY,
        menuItemName: MENU_ITEM,
        isCheckable: true,
        isChecked: previousSetting,
    });
}

function loadSeparateDefaults() {
    for (var i in DEFAULT_SCRIPTS_SEPARATE) {
        Script.load(DEFAULT_SCRIPTS_SEPARATE[i]);
    }
}

function runDefaultsTogether() {
    for (var i in DEFAULT_SCRIPTS_COMBINED) {
        Script.include(DEFAULT_SCRIPTS_COMBINED[i]);
    }
    loadSeparateDefaults();
}

function runDefaultsSeparately() {
    for (var i in DEFAULT_SCRIPTS_COMBINED) {
        Script.load(DEFAULT_SCRIPTS_COMBINED[i]);
    }
    loadSeparateDefaults();
}

// start all scripts
if (Menu.isOptionChecked(MENU_ITEM)) {
    // we're debugging individual default scripts
    // so we load each into its own ScriptEngine instance
    runDefaultsSeparately();
} else {
    // include all default scripts into this ScriptEngine
    runDefaultsTogether();
}

function menuItemEvent(menuItem) {
    if (menuItem === MENU_ITEM) {
        var isChecked = Menu.isOptionChecked(MENU_ITEM);
        if (isChecked === true) {
            Settings.setValue(SETTINGS_KEY, true);
        } else if (isChecked === false) {
            Settings.setValue(SETTINGS_KEY, false);
        }
        Menu.triggerOption("Reload All Scripts");
    }
}

function removeMenuItem() {
    if (!Menu.isOptionChecked(MENU_ITEM)) {
        Menu.removeMenuItem(MENU_CATEGORY, MENU_ITEM);
    }
}

Script.scriptEnding.connect(function() {
    removeMenuItem();
});

Menu.menuItemEvent.connect(menuItemEvent);
