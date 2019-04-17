"use strict";

// Created by Jason C. Najera on 3/7/2019
// Copyright 2019 High Fidelity, Inc.
//
// Handles Push-to-Talk functionality for HMD mode.
//
// Distributed under the Apache License, Version 2.0.
// See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html

Script.include("/~/system/libraries/controllerDispatcherUtils.js");
Script.include("/~/system/libraries/controllers.js");

(function() { // BEGIN LOCAL_SCOPE
    function PushToTalkHandler() {
        var _this = this;
        this.active = false;

        this.shouldTalk = function (controllerData) {
            // Set up test against controllerData here...
            var gripVal = controllerData.secondaryValues[LEFT_HAND] && controllerData.secondaryValues[RIGHT_HAND];
            return (gripVal) ? true : false;
        };

        this.shouldStopTalking = function (controllerData) {
            var gripVal = controllerData.secondaryValues[LEFT_HAND] && controllerData.secondaryValues[RIGHT_HAND];
            return (gripVal) ? false : true;
        };

        this.isReady = function (controllerData, deltaTime) {
            if (HMD.active && Audio.pushToTalk && this.shouldTalk(controllerData)) {
                Audio.pushingToTalk = true;
                return makeRunningValues(true, [], []);
            }

            return makeRunningValues(false, [], []);
        };

        this.run = function (controllerData, deltaTime) {
            if (this.shouldStopTalking(controllerData) || !Audio.pushToTalk) {
                Audio.pushingToTalk = false;
                print("Stop pushing to talk.");
                return makeRunningValues(false, [], []);
            }

            return makeRunningValues(true, [], []);
        };

        this.parameters = makeDispatcherModuleParameters(
            950,
            ["head"],
            [],
            100);
    }

    var pushToTalk = new PushToTalkHandler();
    enableDispatcherModule("PushToTalk", pushToTalk);

    function cleanup() {
        disableDispatcherModule("PushToTalk");
    };

    Script.scriptEnding.connect(cleanup);
}()); // END LOCAL_SCOPE
