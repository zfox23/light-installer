//
//  entitySelectionTool.js
//  examples
//
//  Created by Brad hefta-Gaub on 10/1/14.
//    Modified by Daniela Fontes * @DanielaFifo and Tiago Andrade @TagoWill on 4/7/2017
//    Modified by David Back on 1/9/2018
//  Copyright 2014 High Fidelity, Inc.
//
//  This script implements a class useful for building tools for editing entities.
//
//  Distributed under the Apache License, Version 2.0.
//  See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html
//

/* global SelectionManager, SelectionDisplay, grid, rayPlaneIntersection, rayPlaneIntersection2, pushCommandForSelections,
   getMainTabletIDs, getControllerWorldLocation, TRIGGER_ON_VALUE */

const SPACE_LOCAL = "local";
const SPACE_WORLD = "world";
const HIGHLIGHT_LIST_NAME = "editHandleHighlightList";

Script.include([
    "./controllers.js",
    "./controllerDispatcherUtils.js",
    "./utils.js"
]);


function deepCopy(v) {
    return JSON.parse(JSON.stringify(v));
}

SelectionManager = (function() {
    var that = {};

    // FUNCTION: SUBSCRIBE TO UPDATE MESSAGES
    function subscribeToUpdateMessages() {
        Messages.subscribe("entityToolUpdates");
        Messages.messageReceived.connect(handleEntitySelectionToolUpdates);
    }

    // FUNCTION: HANDLE ENTITY SELECTION TOOL UPDATES
    function handleEntitySelectionToolUpdates(channel, message, sender) {
        if (channel !== 'entityToolUpdates') {
            return;
        }
        if (sender !== MyAvatar.sessionUUID) {
            return;
        }

        var wantDebug = false;
        var messageParsed;
        try {
            messageParsed = JSON.parse(message);
        } catch (err) {
            print("ERROR: entitySelectionTool.handleEntitySelectionToolUpdates - got malformed message");
            return;
        }

        if (messageParsed.method === "selectEntity") {
            if (!SelectionDisplay.triggered() || SelectionDisplay.triggeredHand === messageParsed.hand) {
                if (wantDebug) {
                    print("setting selection to " + messageParsed.entityID);
                }
                that.setSelections([messageParsed.entityID], that);
            }
        } else if (messageParsed.method === "clearSelection") {
            if (!SelectionDisplay.triggered() || SelectionDisplay.triggeredHand === messageParsed.hand) {
                that.clearSelections();
            }
        } else if (messageParsed.method === "pointingAt") {
            if (messageParsed.hand === Controller.Standard.RightHand) {
                that.pointingAtDesktopWindowRight = messageParsed.desktopWindow;
                that.pointingAtTabletRight = messageParsed.tablet;
            } else {
                that.pointingAtDesktopWindowLeft = messageParsed.desktopWindow;
                that.pointingAtTabletLeft = messageParsed.tablet;
            }
        }
    }

    subscribeToUpdateMessages();

    // disabling this for now as it is causing rendering issues with the other handle overlays
    /*
    var COLOR_ORANGE_HIGHLIGHT = { red: 255, green: 99, blue: 9 };
    var editHandleOutlineStyle = {
        outlineUnoccludedColor: COLOR_ORANGE_HIGHLIGHT,
        outlineOccludedColor: COLOR_ORANGE_HIGHLIGHT,
        fillUnoccludedColor: COLOR_ORANGE_HIGHLIGHT,
        fillOccludedColor: COLOR_ORANGE_HIGHLIGHT,
        outlineUnoccludedAlpha: 1,
        outlineOccludedAlpha: 0,
        fillUnoccludedAlpha: 0,
        fillOccludedAlpha: 0,
        outlineWidth: 3,
        isOutlineSmooth: true
    };
    Selection.enableListHighlight(HIGHLIGHT_LIST_NAME, editHandleOutlineStyle);
    */

    that.savedProperties = {};
    that.selections = [];
    var listeners = [];

    that.localRotation = Quat.IDENTITY;
    that.localPosition = Vec3.ZERO;
    that.localDimensions = Vec3.ZERO;
    that.localRegistrationPoint = Vec3.HALF;

    that.worldRotation = Quat.IDENTITY;
    that.worldPosition = Vec3.ZERO;
    that.worldDimensions = Vec3.ZERO;
    that.worldRegistrationPoint = Vec3.HALF;
    that.centerPosition = Vec3.ZERO;
    
    that.pointingAtDesktopWindowLeft = false;
    that.pointingAtDesktopWindowRight = false;
    that.pointingAtTabletLeft = false;
    that.pointingAtTabletRight = false;

    that.saveProperties = function() {
        that.savedProperties = {};
        for (var i = 0; i < that.selections.length; i++) {
            var entityID = that.selections[i];
            that.savedProperties[entityID] = Entities.getEntityProperties(entityID);
        }
    };

    that.addEventListener = function(func, thisContext) {
        listeners.push({
            callback: func,
            thisContext: thisContext
        });
    };

    that.hasSelection = function() {
        return that.selections.length > 0;
    };

    that.setSelections = function(entityIDs, caller) {
        that.selections = [];
        for (var i = 0; i < entityIDs.length; i++) {
            var entityID = entityIDs[i];
            that.selections.push(entityID);
            Selection.addToSelectedItemsList(HIGHLIGHT_LIST_NAME, "entity", entityID);
        }

        that._update(true, caller);
    };

    that.addEntity = function(entityID, toggleSelection, caller) {
        if (entityID) {
            var idx = -1;
            for (var i = 0; i < that.selections.length; i++) {
                if (entityID === that.selections[i]) {
                    idx = i;
                    break;
                }
            }
            if (idx === -1) {
                that.selections.push(entityID);
                Selection.addToSelectedItemsList(HIGHLIGHT_LIST_NAME, "entity", entityID);
            } else if (toggleSelection) {
                that.selections.splice(idx, 1);
                Selection.removeFromSelectedItemsList(HIGHLIGHT_LIST_NAME, "entity", entityID);
            }
        }

        that._update(true, caller);
    };

    function removeEntityByID(entityID) {
        var idx = that.selections.indexOf(entityID);
        if (idx >= 0) {
            that.selections.splice(idx, 1);
            Selection.removeFromSelectedItemsList(HIGHLIGHT_LIST_NAME, "entity", entityID);
        }
    }

    that.removeEntity = function (entityID, caller) {
        removeEntityByID(entityID);
        that._update(true, caller);
    };

    that.removeEntities = function(entityIDs, caller) {
        for (var i = 0, length = entityIDs.length; i < length; i++) {
            removeEntityByID(entityIDs[i]);
        }
        that._update(true, caller);
    };

    that.clearSelections = function(caller) {
        that.selections = [];
        that._update(true, caller);
    };
    
    that.addChildrenEntities = function(parentEntityID, entityList, entityHostType) {
        var wantDebug = false;
        var children = Entities.getChildrenIDs(parentEntityID);
        var entityHostTypes = Entities.getMultipleEntityProperties(children, 'entityHostType');
        for (var i = 0; i < children.length; i++) {
            var childID = children[i];

            if (entityHostTypes[i].entityHostType !== entityHostType) {
                if (wantDebug) {
                    console.log("Skipping addition of entity " + childID + " with conflicting entityHostType: " +
                        entityHostTypes[i].entityHostType);
                }
                continue;
            }

            if (entityList.indexOf(childID) < 0) {
                entityList.push(childID);
            }
            that.addChildrenEntities(childID, entityList, entityHostType);
        }
    };

    // Determine if an entity is being grabbed.
    // This is mostly a heuristic - there is no perfect way to know if an entity is being
    // grabbed.
    //
    // @return {boolean} true if the given entity with `properties` is being grabbed by an avatar
    function nonDynamicEntityIsBeingGrabbedByAvatar(properties) {
        if (properties.dynamic || Uuid.isNull(properties.parentID)) {
            return false;
        }

        var avatar = AvatarList.getAvatar(properties.parentID);
        if (Uuid.isNull(avatar.sessionUUID)) {
            return false;
        }

        var grabJointNames = [
            'RightHand', 'LeftHand',
            '_CONTROLLER_RIGHTHAND', '_CONTROLLER_LEFTHAND',
            '_CAMERA_RELATIVE_CONTROLLER_RIGHTHAND', '_CAMERA_RELATIVE_CONTROLLER_LEFTHAND',
            '_FARGRAB_RIGHTHAND', '_FARGRAB_LEFTHAND', '_FARGRAB_MOUSE'
        ];

        for (var i = 0; i < grabJointNames.length; ++i) {
            if (avatar.getJointIndex(grabJointNames[i]) === properties.parentJointIndex) {
                return true;
            }
        }

        return false;
    }

    var entityClipboard = {
        entities: {}, // Map of id -> properties for copied entities
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 0, y: 0, z: 0 },
    };

    that.duplicateSelection = function() {
        var entitiesToDuplicate = [];
        var duplicatedEntityIDs = [];
        var duplicatedChildrenWithOldParents = [];
        var originalEntityToNewEntityID = [];

        SelectionManager.saveProperties();
        
        // build list of entities to duplicate by including any unselected children of selected parent entities
        var originalEntityIDs = Object.keys(that.savedProperties);
        var entityHostTypes = Entities.getMultipleEntityProperties(originalEntityIDs, 'entityHostType');
        for (var i = 0; i < originalEntityIDs.length; i++) {
            var originalEntityID = originalEntityIDs[i];
            if (entitiesToDuplicate.indexOf(originalEntityID) === -1) {
                entitiesToDuplicate.push(originalEntityID);
            }
            that.addChildrenEntities(originalEntityID, entitiesToDuplicate, entityHostTypes[i].entityHostType);
        }
        
        // duplicate entities from above and store their original to new entity mappings and children needing re-parenting
        for (var i = 0; i < entitiesToDuplicate.length; i++) {
            var originalEntityID = entitiesToDuplicate[i];
            var properties = that.savedProperties[originalEntityID];
            if (properties === undefined) {
                properties = Entities.getEntityProperties(originalEntityID);
            }
            if (!properties.locked && (!properties.avatarEntity || properties.owningAvatarID === MyAvatar.sessionUUID)) {
                if (nonDynamicEntityIsBeingGrabbedByAvatar(properties)) {
                    properties.parentID = null;
                    properties.parentJointIndex = null;
                    properties.localPosition = properties.position;
                    properties.localRotation = properties.rotation;
                }

                properties.localVelocity = Vec3.ZERO;
                properties.localAngularVelocity = Vec3.ZERO;

                delete properties.actionData;
                var newEntityID = Entities.addEntity(properties);

                // Re-apply actions from the original entity
                var actionIDs = Entities.getActionIDs(properties.id);
                for (var j = 0; j < actionIDs.length; ++j) {
                    var actionID = actionIDs[j];
                    var actionArguments = Entities.getActionArguments(properties.id, actionID);
                    if (actionArguments) {
                        var type = actionArguments.type;
                        if (type === 'hold' || type === 'far-grab') {
                            continue;
                        }
                        delete actionArguments.ttl;
                        Entities.addAction(type, newEntityID, actionArguments);
                    }
                }

                duplicatedEntityIDs.push({
                    entityID: newEntityID,
                    properties: properties
                });
                if (properties.parentID !== Uuid.NULL) {
                    duplicatedChildrenWithOldParents[newEntityID] = properties.parentID;
                }
                originalEntityToNewEntityID[originalEntityID] = newEntityID;
            }
        }
        
        // re-parent duplicated children to the duplicate entities of their original parents (if they were duplicated)
        Object.keys(duplicatedChildrenWithOldParents).forEach(function(childIDNeedingNewParent) {
            var originalParentID = duplicatedChildrenWithOldParents[childIDNeedingNewParent];
            var newParentID = originalEntityToNewEntityID[originalParentID];
            if (newParentID) {
                Entities.editEntity(childIDNeedingNewParent, { parentID: newParentID });
                for (var i = 0; i < duplicatedEntityIDs.length; i++) {
                    var duplicatedEntity = duplicatedEntityIDs[i];
                    if (duplicatedEntity.entityID === childIDNeedingNewParent) {
                        duplicatedEntity.properties.parentID = newParentID;
                    }
                }
            }
        });
        
        return duplicatedEntityIDs;
    };

    // Create the entities in entityProperties, maintaining parent-child relationships.
    // @param entityProperties {array} - Array of entity property objects
    that.createEntities = function(entityProperties) {
        var entitiesToCreate = [];
        var createdEntityIDs = [];
        var createdChildrenWithOldParents = [];
        var originalEntityToNewEntityID = [];

        that.saveProperties();

        for (var i = 0; i < entityProperties.length; ++i) {
            var properties = entityProperties[i];
            if (properties.parentID in originalEntityToNewEntityID) {
                properties.parentID = originalEntityToNewEntityID[properties.parentID];
            } else {
                delete properties.parentID;
            }

            delete properties.actionData;
            var newEntityID = Entities.addEntity(properties);

            if (newEntityID) {
                createdEntityIDs.push({
                    entityID: newEntityID,
                    properties: properties
                });
                if (properties.parentID !== Uuid.NULL) {
                    createdChildrenWithOldParents[newEntityID] = properties.parentID;
                }
                originalEntityToNewEntityID[properties.id] = newEntityID;
                properties.id = newEntityID;
            }
        }

        return createdEntityIDs;
    };

    that.cutSelectedEntities = function() {
        that.copySelectedEntities();
        deleteSelectedEntities();
    };

    that.copySelectedEntities = function() {
        var entityProperties = Entities.getMultipleEntityProperties(that.selections);
        var entityHostTypes = Entities.getMultipleEntityProperties(that.selections, 'entityHostType');
        var entities = {};
        entityProperties.forEach(function(props) {
            entities[props.id] = props;
        });

        function appendChildren(entityID, entities, entityHostType) {
            var wantDebug = false;
            var childrenIDs = Entities.getChildrenIDs(entityID);
            var entityHostTypes = Entities.getMultipleEntityProperties(childrenIDs, 'entityHostType');
            for (var i = 0; i < childrenIDs.length; ++i) {
                var id = childrenIDs[i];

                if (entityHostTypes[i].entityHostType !== entityHostType) {
                    if (wantDebug) {
                        console.warn("Skipping deletion of entity " + id + " with conflicting entityHostType: " +
                            entityHostTypes[i].entityHostType);
                    }
                    continue;
                }

                if (!(id in entities)) {
                    entities[id] = Entities.getEntityProperties(id); 
                    appendChildren(id, entities);
                }
            }
        }

        var len = entityProperties.length;
        for (var i = 0; i < len; ++i) {
            appendChildren(entityProperties[i].id, entities, entityHostTypes[i].entityHostType);
        }

        for (var id in entities) {
            var parentID = entities[id].parentID;
            entities[id].root = !(parentID in entities);
        }

        entityClipboard.entities = [];

        var ids = Object.keys(entities);
        while (ids.length > 0) {
            // Go through all remaining entities.
            // If an entity does not have a parent left, move it into the list
            for (var i = 0; i < ids.length; ++i) {
                var id = ids[i];
                var parentID = entities[id].parentID;
                if (parentID in entities) {
                    continue;
                }
                entityClipboard.entities.push(entities[id]);
                delete entities[id];
            }
            ids = Object.keys(entities);
        }

        // Calculate size
        if (entityClipboard.entities.length === 0) {
            entityClipboard.dimensions = { x: 0, y: 0, z: 0 };
            entityClipboard.position = { x: 0, y: 0, z: 0 };
        } else {
            var properties = entityClipboard.entities;
            var brn = properties[0].boundingBox.brn;
            var tfl = properties[0].boundingBox.tfl;
            for (var i = 1; i < properties.length; i++) {
                var bb = properties[i].boundingBox;
                brn.x = Math.min(bb.brn.x, brn.x);
                brn.y = Math.min(bb.brn.y, brn.y);
                brn.z = Math.min(bb.brn.z, brn.z);
                tfl.x = Math.max(bb.tfl.x, tfl.x);
                tfl.y = Math.max(bb.tfl.y, tfl.y);
                tfl.z = Math.max(bb.tfl.z, tfl.z);
            }
            entityClipboard.dimensions = {
                x: tfl.x - brn.x,
                y: tfl.y - brn.y,
                z: tfl.z - brn.z
            };
            entityClipboard.position = {
                x: brn.x + entityClipboard.dimensions.x / 2,
                y: brn.y + entityClipboard.dimensions.y / 2,
                z: brn.z + entityClipboard.dimensions.z / 2
            };
        }
    };

    that.pasteEntities = function() {
        var dimensions = entityClipboard.dimensions;
        var maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z);
        var pastePosition = getPositionToCreateEntity(maxDimension);
        var deltaPosition = Vec3.subtract(pastePosition, entityClipboard.position);

        var copiedProperties = [];
        var ids = [];
        entityClipboard.entities.forEach(function(originalProperties) {
            var properties = deepCopy(originalProperties);
            if (properties.root) {
                properties.position = Vec3.sum(properties.position, deltaPosition);
                delete properties.localPosition;
            } else {
                delete properties.position;
            }
            copiedProperties.push(properties);
        });

        var currentSelections = deepCopy(SelectionManager.selections);

        function redo(copiedProperties) {
            var created = that.createEntities(copiedProperties);
            var ids = [];
            for (var i = 0; i < created.length; ++i) {
                ids.push(created[i].entityID);
            }
            SelectionManager.setSelections(ids);
        }

        function undo(copiedProperties) {
            for (var i = 0; i < copiedProperties.length; ++i) {
                Entities.deleteEntity(copiedProperties[i].id);
            }
            SelectionManager.setSelections(currentSelections);
        }

        redo(copiedProperties);
        undoHistory.pushCommand(undo, copiedProperties, redo, copiedProperties);
    };

    that._update = function(selectionUpdated, caller) {
        var properties = null;
        if (that.selections.length === 0) {
            that.localDimensions = null;
            that.localPosition = null;
            that.worldDimensions = null;
            that.worldPosition = null;
            that.worldRotation = null;
        } else if (that.selections.length === 1) {
            properties = Entities.getEntityProperties(that.selections[0],
                ['dimensions', 'position', 'rotation', 'registrationPoint', 'boundingBox', 'type']);
            that.localDimensions = properties.dimensions;
            that.localPosition = properties.position;
            that.localRotation = properties.rotation;
            that.localRegistrationPoint = properties.registrationPoint;

            that.worldDimensions = properties.boundingBox.dimensions;
            that.worldPosition = properties.boundingBox.center;
            that.worldRotation = Quat.IDENTITY;

            that.entityType = properties.type;
            
            if (selectionUpdated) {
                SelectionDisplay.useDesiredSpaceMode();
            }
        } else {
            properties = Entities.getEntityProperties(that.selections[0], ['type', 'boundingBox']);

            that.entityType = properties.type;

            var brn = properties.boundingBox.brn;
            var tfl = properties.boundingBox.tfl;

            for (var i = 1; i < that.selections.length; i++) {
                properties = Entities.getEntityProperties(that.selections[i], 'boundingBox');
                var bb = properties.boundingBox;
                brn.x = Math.min(bb.brn.x, brn.x);
                brn.y = Math.min(bb.brn.y, brn.y);
                brn.z = Math.min(bb.brn.z, brn.z);
                tfl.x = Math.max(bb.tfl.x, tfl.x);
                tfl.y = Math.max(bb.tfl.y, tfl.y);
                tfl.z = Math.max(bb.tfl.z, tfl.z);
            }

            that.localRotation = null;
            that.localDimensions = null;
            that.localPosition = null;
            that.worldDimensions = {
                x: tfl.x - brn.x,
                y: tfl.y - brn.y,
                z: tfl.z - brn.z
            };
            that.worldRotation = Quat.IDENTITY;
            that.worldPosition = {
                x: brn.x + (that.worldDimensions.x / 2),
                y: brn.y + (that.worldDimensions.y / 2),
                z: brn.z + (that.worldDimensions.z / 2)
            };

            // For 1+ selections we can only modify selections in world space
            SelectionDisplay.setSpaceMode(SPACE_WORLD, false);
        }

        for (var j = 0; j < listeners.length; j++) {
            try {
                listeners[j].callback.call(listeners[j].thisContext, selectionUpdated === true, caller);
            } catch (e) {
                print("ERROR: entitySelectionTool.update got exception: " + JSON.stringify(e));
            }
        }
    };

    return that;
})();

// Normalize degrees to be in the range (-180, 180)
function normalizeDegrees(degrees) {
    var maxDegrees = 360;
    var halfMaxDegrees = maxDegrees / 2;
    degrees = ((degrees + halfMaxDegrees) % maxDegrees) - halfMaxDegrees;
    if (degrees <= -halfMaxDegrees) {
        degrees += maxDegrees;
    }
    return degrees;
}

// SELECTION DISPLAY DEFINITION
SelectionDisplay = (function() {
    var that = {};

    const COLOR_GREEN = { red: 31, green: 198, blue: 166 };
    const COLOR_BLUE = { red: 0, green: 147, blue: 197 };
    const COLOR_RED = { red: 226, green: 51, blue: 77 };
    const COLOR_HOVER = { red: 227, green: 227, blue: 227 };
    const COLOR_ROTATE_CURRENT_RING = { red: 255, green: 99, blue: 9 };
    const COLOR_BOUNDING_EDGE = { red: 87, green: 87, blue: 87 };
    const COLOR_SCALE_CUBE = { red: 106, green: 106, blue: 106 };
    const COLOR_SCALE_CUBE_SELECTED = { red: 18, green: 18, blue: 18 };
    const COLOR_DEBUG_PICK_PLANE = { red: 255, green: 255, blue: 255 };
    const COLOR_DEBUG_PICK_PLANE_HIT = { red: 255, green: 165, blue: 0 };

    const TRANSLATE_ARROW_CYLINDER_OFFSET = 0.1;
    const TRANSLATE_ARROW_CYLINDER_CAMERA_DISTANCE_MULTIPLE = 0.005;
    const TRANSLATE_ARROW_CYLINDER_Y_MULTIPLE = 7.5;
    const TRANSLATE_ARROW_CONE_CAMERA_DISTANCE_MULTIPLE = 0.025;
    const TRANSLATE_ARROW_CONE_OFFSET_CYLINDER_DIMENSION_MULTIPLE = 0.83;

    const ROTATE_RING_CAMERA_DISTANCE_MULTIPLE = 0.15;
    const ROTATE_CTRL_SNAP_ANGLE = 22.5;
    const ROTATE_DEFAULT_SNAP_ANGLE = 1;
    const ROTATE_DEFAULT_TICK_MARKS_ANGLE = 5;
    const ROTATE_RING_IDLE_INNER_RADIUS = 0.92;
    const ROTATE_RING_SELECTED_INNER_RADIUS = 0.9;

    // These are multipliers for sizing the rotation degrees display while rotating an entity
    const ROTATE_DISPLAY_DISTANCE_MULTIPLIER = 2;
    const ROTATE_DISPLAY_SIZE_X_MULTIPLIER = 0.2;
    const ROTATE_DISPLAY_SIZE_Y_MULTIPLIER = 0.09;
    const ROTATE_DISPLAY_LINE_HEIGHT_MULTIPLIER = 0.07;

    const STRETCH_CUBE_OFFSET = 0.06;
    const STRETCH_CUBE_CAMERA_DISTANCE_MULTIPLE = 0.02;
    const STRETCH_PANEL_WIDTH = 0.01;

    const SCALE_OVERLAY_CAMERA_DISTANCE_MULTIPLE = 0.02;
    const SCALE_DIMENSIONS_CAMERA_DISTANCE_MULTIPLE = 0.5;
    
    const BOUNDING_EDGE_OFFSET = 0.5;

    const DUPLICATOR_OFFSET = { x: 0.9, y: -0.9, z: 0.9 };    
    
    const CTRL_KEY_CODE = 16777249;

    const RAIL_AXIS_LENGTH = 10000;
    
    const NEGATE_VECTOR = -1;
    const NO_HAND = -1;
    
    const DEBUG_PICK_PLANE_HIT_LIMIT = 200;
    const DEBUG_PICK_PLANE_HIT_CAMERA_DISTANCE_MULTIPLE = 0.01;

    const TRANSLATE_DIRECTION = {
        X: 0,
        Y: 1,
        Z: 2
    };

    const STRETCH_DIRECTION = {
        X: 0,
        Y: 1,
        Z: 2,
        ALL: 3
    };

    const ROTATE_DIRECTION = {
        PITCH: 0,
        YAW: 1,
        ROLL: 2
    };

    const INEDIT_STATUS_CHANNEL = "Hifi-InEdit-Status";

    /**
     * The current space mode, this could have been a forced space mode since we do not support multi selection while in
     * local space mode.
     * @type {string} - should only be set to SPACE_LOCAL or SPACE_WORLD
     */
    var spaceMode = SPACE_LOCAL;

    /**
     * The desired space mode, this is the user set space mode, which should be respected whenever it is possible. In the case
     * of multi entity selection this space mode may differ from the actual spaceMode.
     * @type {string} - should only be set to SPACE_LOCAL or SPACE_WORLD
     */
    var desiredSpaceMode = SPACE_LOCAL;

    var overlayNames = [];
    var lastControllerPoses = [
        getControllerWorldLocation(Controller.Standard.LeftHand, true),
        getControllerWorldLocation(Controller.Standard.RightHand, true)
    ];

    var worldRotationX;
    var worldRotationY;
    var worldRotationZ;
    
    var activeStretchCubePanelOffset = null;

    var previousHandle = null;
    var previousHandleHelper = null;
    var previousHandleColor;

    var ctrlPressed = false;

    that.replaceCollisionsAfterStretch = false;

    var handlePropertiesTranslateArrowCones = {
        alpha: 1,
        shape: "Cone",
        solid: true,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true
    };
    var handlePropertiesTranslateArrowCylinders = {
        alpha: 1,
        shape: "Cylinder",
        solid: true,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true
    };
    var handleTranslateXCone = Overlays.addOverlay("shape", handlePropertiesTranslateArrowCones);
    var handleTranslateXCylinder = Overlays.addOverlay("shape", handlePropertiesTranslateArrowCylinders);
    Overlays.editOverlay(handleTranslateXCone, { color: COLOR_RED });
    Overlays.editOverlay(handleTranslateXCylinder, { color: COLOR_RED });
    var handleTranslateYCone = Overlays.addOverlay("shape", handlePropertiesTranslateArrowCones);
    var handleTranslateYCylinder = Overlays.addOverlay("shape", handlePropertiesTranslateArrowCylinders);
    Overlays.editOverlay(handleTranslateYCone, { color: COLOR_GREEN });
    Overlays.editOverlay(handleTranslateYCylinder, { color: COLOR_GREEN });
    var handleTranslateZCone = Overlays.addOverlay("shape", handlePropertiesTranslateArrowCones);
    var handleTranslateZCylinder = Overlays.addOverlay("shape", handlePropertiesTranslateArrowCylinders);
    Overlays.editOverlay(handleTranslateZCone, { color: COLOR_BLUE });
    Overlays.editOverlay(handleTranslateZCylinder, { color: COLOR_BLUE });

    var handlePropertiesRotateRings = {
        alpha: 1,
        solid: true,
        startAt: 0,
        endAt: 360,
        innerRadius: ROTATE_RING_IDLE_INNER_RADIUS,
        majorTickMarksAngle: ROTATE_DEFAULT_TICK_MARKS_ANGLE,
        majorTickMarksLength: 0.1,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true
    };
    var handleRotatePitchRing = Overlays.addOverlay("circle3d", handlePropertiesRotateRings);
    Overlays.editOverlay(handleRotatePitchRing, { 
        color: COLOR_RED,
        majorTickMarksColor: COLOR_RED
    });
    var handleRotateYawRing = Overlays.addOverlay("circle3d", handlePropertiesRotateRings);
    Overlays.editOverlay(handleRotateYawRing, { 
        color: COLOR_GREEN,
        majorTickMarksColor: COLOR_GREEN
    });
    var handleRotateRollRing = Overlays.addOverlay("circle3d", handlePropertiesRotateRings);
    Overlays.editOverlay(handleRotateRollRing, { 
        color: COLOR_BLUE,
        majorTickMarksColor: COLOR_BLUE
    });

    var handleRotateCurrentRing = Overlays.addOverlay("circle3d", {
        alpha: 1,
        color: COLOR_ROTATE_CURRENT_RING,
        solid: true,
        innerRadius: 0.9,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true
    });

    var rotationDegreesDisplay = Overlays.addOverlay("text3d", {
        text: "",
        color: { red: 0, green: 0, blue: 0 },
        backgroundColor: { red: 255, green: 255, blue: 255 },
        alpha: 0.7,
        backgroundAlpha: 0.7,
        visible: false,
        isFacingAvatar: true,
        drawInFront: true,
        ignorePickIntersection: true,
        dimensions: { x: 0, y: 0 },
        lineHeight: 0.0,
        topMargin: 0,
        rightMargin: 0,
        bottomMargin: 0,
        leftMargin: 0
    });

    var handlePropertiesStretchCubes = {
        solid: true,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true
    };
    var handleStretchXCube = Overlays.addOverlay("cube", handlePropertiesStretchCubes);
    Overlays.editOverlay(handleStretchXCube, { color: COLOR_RED });
    var handleStretchYCube = Overlays.addOverlay("cube", handlePropertiesStretchCubes);
    Overlays.editOverlay(handleStretchYCube, { color: COLOR_GREEN });
    var handleStretchZCube = Overlays.addOverlay("cube", handlePropertiesStretchCubes);
    Overlays.editOverlay(handleStretchZCube, { color: COLOR_BLUE });

    var handlePropertiesStretchPanel = {
        alpha: 0.5,
        solid: true,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true
    };
    var handleStretchXPanel = Overlays.addOverlay("cube", handlePropertiesStretchPanel);
    Overlays.editOverlay(handleStretchXPanel, { color: COLOR_RED });
    var handleStretchYPanel = Overlays.addOverlay("cube", handlePropertiesStretchPanel);
    Overlays.editOverlay(handleStretchYPanel, { color: COLOR_GREEN });
    var handleStretchZPanel = Overlays.addOverlay("cube", handlePropertiesStretchPanel);
    Overlays.editOverlay(handleStretchZPanel, { color: COLOR_BLUE });

    var handleScaleCube = Overlays.addOverlay("cube", {
        size: 0.025,
        color: COLOR_SCALE_CUBE,
        solid: true,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true,
        borderSize: 1.4
    });

    var handleBoundingBox = Overlays.addOverlay("cube", {
        alpha: 1,
        color: COLOR_BOUNDING_EDGE,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true,
        isSolid: false
    });

    var handleDuplicator = Overlays.addOverlay("cube", {
        alpha: 1,
        size: 0.05,
        color: COLOR_GREEN,
        solid: true,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: true,
        borderSize: 1.4
    });

    // setting to 0 alpha for now to keep this hidden vs using visible false 
    // because its used as the translate xz tool handle overlay
    var selectionBox = Overlays.addOverlay("cube", {
        size: 1,
        color: COLOR_RED,
        alpha: 0,
        solid: false,
        visible: false,
        ignorePickIntersection: true,
        dashed: false
    });

    // Handle for x-z translation of particle effect and light entities while inside the bounding box.
    // Limitation: If multiple entities are selected, only the first entity's icon translates the selection.
    var iconSelectionBox = Overlays.addOverlay("cube", {
        size: 0.3, // Match entity icon size.
        color: COLOR_RED,
        alpha: 0,
        solid: false,
        visible: false,
        ignorePickIntersection: true,
        dashed: false
    });

    var xRailOverlay = Overlays.addOverlay("line3d", {
        visible: false,
        start: Vec3.ZERO,
        end: Vec3.ZERO,
        color: {
            red: 255,
            green: 0,
            blue: 0
        },
        ignorePickIntersection: true // always ignore this
    });
    var yRailOverlay = Overlays.addOverlay("line3d", {
        visible: false,
        start: Vec3.ZERO,
        end: Vec3.ZERO,
        color: {
            red: 0,
            green: 255,
            blue: 0
        },
        ignorePickIntersection: true // always ignore this
    });
    var zRailOverlay = Overlays.addOverlay("line3d", {
        visible: false,
        start: Vec3.ZERO,
        end: Vec3.ZERO,
        color: {
            red: 0,
            green: 0,
            blue: 255
        },
        ignorePickIntersection: true // always ignore this
    });

    var allOverlays = [
        handleTranslateXCone,
        handleTranslateXCylinder,
        handleTranslateYCone,
        handleTranslateYCylinder,
        handleTranslateZCone,
        handleTranslateZCylinder,
        handleRotatePitchRing,
        handleRotateYawRing,
        handleRotateRollRing,
        handleRotateCurrentRing,
        rotationDegreesDisplay,
        handleStretchXCube,
        handleStretchYCube,
        handleStretchZCube,
        handleStretchXPanel,
        handleStretchYPanel,
        handleStretchZPanel,
        handleScaleCube,
        handleBoundingBox,
        handleDuplicator,
        selectionBox,
        iconSelectionBox,
        xRailOverlay,
        yRailOverlay,
        zRailOverlay
    ];

    const nonLayeredOverlays = [selectionBox, iconSelectionBox];

    var maximumHandleInAllOverlays = handleDuplicator;

    overlayNames[handleTranslateXCone] = "handleTranslateXCone";
    overlayNames[handleTranslateXCylinder] = "handleTranslateXCylinder";
    overlayNames[handleTranslateYCone] = "handleTranslateYCone";
    overlayNames[handleTranslateYCylinder] = "handleTranslateYCylinder";
    overlayNames[handleTranslateZCone] = "handleTranslateZCone";
    overlayNames[handleTranslateZCylinder] = "handleTranslateZCylinder";

    overlayNames[handleRotatePitchRing] = "handleRotatePitchRing";
    overlayNames[handleRotateYawRing] = "handleRotateYawRing";
    overlayNames[handleRotateRollRing] = "handleRotateRollRing";
    overlayNames[handleRotateCurrentRing] = "handleRotateCurrentRing";
    overlayNames[rotationDegreesDisplay] = "rotationDegreesDisplay";

    overlayNames[handleStretchXCube] = "handleStretchXCube";
    overlayNames[handleStretchYCube] = "handleStretchYCube";
    overlayNames[handleStretchZCube] = "handleStretchZCube";
    overlayNames[handleStretchXPanel] = "handleStretchXPanel";
    overlayNames[handleStretchYPanel] = "handleStretchYPanel";
    overlayNames[handleStretchZPanel] = "handleStretchZPanel";

    overlayNames[handleScaleCube] = "handleScaleCube";

    overlayNames[handleBoundingBox] = "handleBoundingBox";

    overlayNames[handleDuplicator] = "handleDuplicator";
    overlayNames[selectionBox] = "selectionBox";
    overlayNames[iconSelectionBox] = "iconSelectionBox";

    var activeTool = null;
    var handleTools = {};
    
    var debugPickPlaneEnabled = false;
    var debugPickPlane = Overlays.addOverlay("shape", {
        shape: "Quad",
        alpha: 0.25,
        color: COLOR_DEBUG_PICK_PLANE,
        solid: true,
        visible: false,
        ignorePickIntersection: true,
        drawInFront: false
    });
    var debugPickPlaneHits = [];

    // We get mouseMoveEvents from the handControllers, via handControllerPointer.
    // But we dont' get mousePressEvents.
    that.triggerClickMapping = Controller.newMapping(Script.resolvePath('') + '-click');
    that.triggerPressMapping = Controller.newMapping(Script.resolvePath('') + '-press');
    that.triggeredHand = NO_HAND;
    that.pressedHand = NO_HAND;
    that.editingHand = NO_HAND;
    that.triggered = function() {
        return that.triggeredHand !== NO_HAND;
    };
    function pointingAtDesktopWindowOrTablet(hand) {
        var pointingAtDesktopWindow = (hand === Controller.Standard.RightHand && 
                                       SelectionManager.pointingAtDesktopWindowRight) ||
                                      (hand === Controller.Standard.LeftHand && 
                                       SelectionManager.pointingAtDesktopWindowLeft);
        var pointingAtTablet = (hand === Controller.Standard.RightHand && SelectionManager.pointingAtTabletRight) ||
                               (hand === Controller.Standard.LeftHand && SelectionManager.pointingAtTabletLeft);
        return pointingAtDesktopWindow || pointingAtTablet;
    }
    function makeClickHandler(hand) {
        return function (clicked) {
            // Don't allow both hands to trigger at the same time
            if (that.triggered() && hand !== that.triggeredHand) {
                return;
            }
            if (!that.triggered() && clicked && !pointingAtDesktopWindowOrTablet(hand)) {
                that.triggeredHand = hand;
                that.mousePressEvent({});
            } else if (that.triggered() && !clicked) {
                that.triggeredHand = NO_HAND;
                that.mouseReleaseEvent({});
            }
        };
    }
    function makePressHandler(hand) {
        return function (value) {
            if (value >= TRIGGER_ON_VALUE && !that.triggered() && !pointingAtDesktopWindowOrTablet(hand)) {
                that.pressedHand = hand;
                that.updateHighlight({});
            } else {
                that.pressedHand = NO_HAND;
                that.resetPreviousHandleColor();
            }
        }
    }
    that.triggerClickMapping.from(Controller.Standard.RTClick).peek().to(makeClickHandler(Controller.Standard.RightHand));
    that.triggerClickMapping.from(Controller.Standard.LTClick).peek().to(makeClickHandler(Controller.Standard.LeftHand));
    that.triggerPressMapping.from(Controller.Standard.RT).peek().to(makePressHandler(Controller.Standard.RightHand));
    that.triggerPressMapping.from(Controller.Standard.LT).peek().to(makePressHandler(Controller.Standard.LeftHand));
    that.enableTriggerMapping = function() {
        that.triggerClickMapping.enable();
        that.triggerPressMapping.enable();
    };
    that.disableTriggerMapping = function() {
        that.triggerClickMapping.disable();
        that.triggerPressMapping.disable();
    };
    Script.scriptEnding.connect(that.disableTriggerMapping);

    // FUNCTION DEF(s): Intersection Check Helpers
    function testRayIntersect(queryRay, overlayIncludes, overlayExcludes) {
        var wantDebug = false;
        if ((queryRay === undefined) || (queryRay === null)) {
            if (wantDebug) {
                print("testRayIntersect - EARLY EXIT -> queryRay is undefined OR null!");
            }
            return null;
        }

        // We want to first check the drawInFront overlays (i.e. the handles, but really everything except the selectionBoxes)
        // so that you can click on them even when they're behind things
        var overlayIncludesLayered = [];
        var overlayIncludesNonLayered = [];
        for (var i = 0; i < overlayIncludes.length; i++) {
            var value = overlayIncludes[i];
            var contains = false;
            for (var j = 0; j < nonLayeredOverlays.length; j++) {
                if (nonLayeredOverlays[j] === value) {
                    contains = true;
                    break;
                }
            }
            if (contains) {
                overlayIncludesNonLayered.push(value);
            } else {
                overlayIncludesLayered.push(value);
            }
        }

        var intersectObj = Overlays.findRayIntersection(queryRay, true, overlayIncludesLayered, overlayExcludes);

        if (!intersectObj.intersects && overlayIncludesNonLayered.length > 0) {
            intersectObj = Overlays.findRayIntersection(queryRay, true, overlayIncludesNonLayered, overlayExcludes);
        }

        if (wantDebug) {
            if (!overlayIncludes) {
                print("testRayIntersect - no overlayIncludes provided.");
            }
            if (!overlayExcludes) {
                print("testRayIntersect - no overlayExcludes provided.");
            }
            print("testRayIntersect - Hit: " + intersectObj.intersects);
            print("    intersectObj.overlayID:" + intersectObj.overlayID + "[" + overlayNames[intersectObj.overlayID] + "]");
            print("        OverlayName: " + overlayNames[intersectObj.overlayID]);
            print("    intersectObj.distance:" + intersectObj.distance);
            print("    intersectObj.face:" + intersectObj.face);
            Vec3.print("    intersectObj.intersection:", intersectObj.intersection);
        }

        return intersectObj;
    }

    function isPointInsideBox(point, box) {
        var position = Vec3.subtract(point, box.position);
        position = Vec3.multiplyQbyV(Quat.inverse(box.rotation), position);
        return Math.abs(position.x) <= box.dimensions.x / 2 && Math.abs(position.y) <= box.dimensions.y / 2
            && Math.abs(position.z) <= box.dimensions.z / 2;
    }
    
    that.isEditHandle = function(overlayID) {
        var overlayIndex = allOverlays.indexOf(overlayID);
        var maxHandleIndex = allOverlays.indexOf(maximumHandleInAllOverlays);
        return overlayIndex >= 0 && overlayIndex <= maxHandleIndex;
    };

    // FUNCTION: MOUSE PRESS EVENT
    that.mousePressEvent = function (event) {
        var wantDebug = false;
        if (wantDebug) {
            print("=============== eST::MousePressEvent BEG =======================");
        }
        if (!event.isLeftButton && !that.triggered()) {
            // EARLY EXIT-(if another mouse button than left is pressed ignore it)
            return false;
        }

        var pickRay = generalComputePickRay(event.x, event.y);
        // TODO_Case6491:  Move this out to setup just to make it once
        var interactiveOverlays = getMainTabletIDs();
        for (var key in handleTools) {
            if (handleTools.hasOwnProperty(key)) {
                interactiveOverlays.push(key);
            }
        }

        // Start with unknown mode, in case no tool can handle this.
        activeTool = null;

        var results = testRayIntersect(pickRay, interactiveOverlays);
        if (results.intersects) {
            var hitOverlayID = results.overlayID;
            if ((HMD.tabletID && hitOverlayID === HMD.tabletID) || (HMD.tabletScreenID && hitOverlayID === HMD.tabletScreenID)
                || (HMD.homeButtonID && hitOverlayID === HMD.homeButtonID)) {
                // EARLY EXIT-(mouse clicks on the tablet should override the edit affordances)
                return false;
            }

            var hitTool = handleTools[ hitOverlayID ];
            if (hitTool) {
                activeTool = hitTool;
                that.clearDebugPickPlane();
                if (activeTool.onBegin) {
                    that.editingHand = that.triggeredHand;
                    Messages.sendLocalMessage(INEDIT_STATUS_CHANNEL, JSON.stringify({
                        method: "editing",
                        hand: that.editingHand === Controller.Standard.LeftHand ? LEFT_HAND : RIGHT_HAND,
                        editing: true
                    }));
                    activeTool.onBegin(event, pickRay, results);
                } else {
                    print("ERROR: entitySelectionTool.mousePressEvent - ActiveTool(" + activeTool.mode + ") missing onBegin");
                }
            } else {
                print("ERROR: entitySelectionTool.mousePressEvent - Hit unexpected object, check interactiveOverlays");
            }// End_if (hitTool)
        }// End_If(results.intersects)

        if (wantDebug) {
            print("    DisplayMode: " + getMode());
            print("=============== eST::MousePressEvent END =======================");
        }

        // If mode is known then we successfully handled this;
        // otherwise, we're missing a tool.
        return activeTool;
    };

    that.resetPreviousHandleColor = function() {
        if (previousHandle !== null) {
            Overlays.editOverlay(previousHandle, { color: previousHandleColor });
            previousHandle = null;
        }
        if (previousHandleHelper !== null) {
            Overlays.editOverlay(previousHandleHelper, { color: previousHandleColor });
            previousHandleHelper = null;
        }
    };

    that.getHandleHelper = function(overlay) {
        if (overlay === handleTranslateXCone) {
            return handleTranslateXCylinder;
        } else if (overlay === handleTranslateXCylinder) {
            return handleTranslateXCone;
        } else if (overlay === handleTranslateYCone) {
            return handleTranslateYCylinder;
        } else if (overlay === handleTranslateYCylinder) {
            return handleTranslateYCone;
        } else if (overlay === handleTranslateZCone) {
            return handleTranslateZCylinder;
        } else if (overlay === handleTranslateZCylinder) {
            return handleTranslateZCone;
        }
        return Uuid.NULL;
    };
    
    that.updateHighlight = function(event) {
        // if no tool is active, then just look for handles to highlight...
        var pickRay = generalComputePickRay(event.x, event.y);        
        var result = testRayIntersect(pickRay, allOverlays);
        var pickedColor;
        var highlightNeeded = false;

        if (result.intersects) {
            switch (result.overlayID) {
                case handleTranslateXCone:
                case handleTranslateXCylinder:
                case handleRotatePitchRing:
                case handleStretchXCube:
                    pickedColor = COLOR_RED;
                    highlightNeeded = true;
                    break;
                case handleTranslateYCone:
                case handleTranslateYCylinder:
                case handleRotateYawRing:
                case handleStretchYCube:
                    pickedColor = COLOR_GREEN;
                    highlightNeeded = true;
                    break;
                case handleTranslateZCone:
                case handleTranslateZCylinder:
                case handleRotateRollRing:
                case handleStretchZCube:
                    pickedColor = COLOR_BLUE;
                    highlightNeeded = true;
                    break;
                case handleScaleCube:
                    pickedColor = COLOR_SCALE_CUBE;
                    highlightNeeded = true;
                    break;
                default:
                    that.resetPreviousHandleColor();
                    break;
            }

            if (highlightNeeded) {
                that.resetPreviousHandleColor();
                Overlays.editOverlay(result.overlayID, { color: COLOR_HOVER });
                previousHandle = result.overlayID;
                previousHandleHelper = that.getHandleHelper(result.overlayID);
                if (previousHandleHelper !== null) {
                    Overlays.editOverlay(previousHandleHelper, { color: COLOR_HOVER });
                }
                previousHandleColor = pickedColor;
            }

        } else {
            that.resetPreviousHandleColor();
        }
    };

    // FUNCTION: MOUSE MOVE EVENT
    var lastMouseEvent = null;
    that.mouseMoveEvent = function(event) {
        var wantDebug = false;
        if (wantDebug) {
            print("=============== eST::MouseMoveEvent BEG =======================");
        }
        lastMouseEvent = event;
        if (activeTool) {
            if (wantDebug) {
                print("    Trigger ActiveTool(" + activeTool.mode + ")'s onMove");
            }
            activeTool.onMove(event);

            if (wantDebug) {
                print("    Trigger SelectionManager::update");
            }
            SelectionManager._update(false, that);

            if (wantDebug) {
                print("=============== eST::MouseMoveEvent END =======================");
            }
            // EARLY EXIT--(Move handled via active tool)
            return true;
        }

        that.updateHighlight(event);
        
        if (wantDebug) {
            print("=============== eST::MouseMoveEvent END =======================");
        }
        return false;
    };

    // FUNCTION: MOUSE RELEASE EVENT
    that.mouseReleaseEvent = function(event) {
        var wantDebug = false;
        if (wantDebug) {
            print("=============== eST::MouseReleaseEvent BEG =======================");
        }
        var showHandles = false;
        if (activeTool) {
            if (activeTool.onEnd) {
                if (wantDebug) {
                    print("    Triggering ActiveTool(" + activeTool.mode + ")'s onEnd");
                }
                Messages.sendLocalMessage(INEDIT_STATUS_CHANNEL, JSON.stringify({
                    method: "editing",
                    hand: that.editingHand === Controller.Standard.LeftHand ? LEFT_HAND : RIGHT_HAND,
                    editing: false
                }));
                that.editingHand = NO_HAND;
                activeTool.onEnd(event);
            } else if (wantDebug) {
                print("    ActiveTool(" + activeTool.mode + ")'s missing onEnd");
            }
        }

        showHandles = activeTool; // base on prior tool value
        activeTool = null;

        // if something is selected, then reset the "original" properties for any potential next click+move operation
        if (SelectionManager.hasSelection()) {
            if (showHandles) {
                if (wantDebug) {
                    print("    Triggering that.select");
                }
                that.select(SelectionManager.selections[0], event);
            }
        }

        if (wantDebug) {
            print("=============== eST::MouseReleaseEvent END =======================");
        }
    };

    // Control key remains active only while key is held down
    that.keyReleaseEvent = function(event) {
        if (event.key === CTRL_KEY_CODE) {
            ctrlPressed = false;
            that.updateActiveRotateRing();
        }
        if (activeTool && lastMouseEvent !== null) {
            lastMouseEvent.isShifted = event.isShifted;
            lastMouseEvent.isMeta = event.isMeta;
            lastMouseEvent.isControl = event.isControl;
            lastMouseEvent.isAlt = event.isAlt;
            activeTool.onMove(lastMouseEvent);
            SelectionManager._update(false, this);
        }
    };

    // Triggers notification on specific key driven events
    that.keyPressEvent = function(event) {
        if (event.key === CTRL_KEY_CODE) {
            ctrlPressed = true;
            that.updateActiveRotateRing();
        }
        if (activeTool && lastMouseEvent !== null) {
            lastMouseEvent.isShifted = event.isShifted;
            lastMouseEvent.isMeta = event.isMeta;
            lastMouseEvent.isControl = event.isControl;
            lastMouseEvent.isAlt = event.isAlt;
            activeTool.onMove(lastMouseEvent);
            SelectionManager._update(false, this);
        }
    };

    // NOTE: mousePressEvent and mouseMoveEvent from the main script should call us., so we don't hook these:
    //       Controller.mousePressEvent.connect(that.mousePressEvent);
    //       Controller.mouseMoveEvent.connect(that.mouseMoveEvent);
    Controller.mouseReleaseEvent.connect(that.mouseReleaseEvent);
    Controller.keyPressEvent.connect(that.keyPressEvent);
    Controller.keyReleaseEvent.connect(that.keyReleaseEvent);

    that.checkControllerMove = function() {
        if (SelectionManager.hasSelection()) {
            var controllerPose = getControllerWorldLocation(that.triggeredHand, true);
            var hand = (that.triggeredHand === Controller.Standard.LeftHand) ? 0 : 1;
            if (controllerPose.valid && lastControllerPoses[hand].valid && that.triggered()) {
                if (!Vec3.equal(controllerPose.position, lastControllerPoses[hand].position) ||
                    !Vec3.equal(controllerPose.rotation, lastControllerPoses[hand].rotation)) {
                    that.mouseMoveEvent({});
                }
            }
            lastControllerPoses[hand] = controllerPose;
        }
    };

    function controllerComputePickRay() {
        var hand = that.triggered() ? that.triggeredHand : that.pressedHand;
        var controllerPose = getControllerWorldLocation(hand, true);
        if (controllerPose.valid) {
            var controllerPosition = controllerPose.translation;
            // This gets point direction right, but if you want general quaternion it would be more complicated:
            var controllerDirection = Quat.getUp(controllerPose.rotation);
            return {origin: controllerPosition, direction: controllerDirection};
        }
    }

    function generalComputePickRay(x, y) {
        return controllerComputePickRay() || Camera.computePickRay(x, y);
    }
    
    function getControllerAvatarFramePositionFromPickRay(pickRay) {
        var controllerPosition = Vec3.subtract(pickRay.origin, MyAvatar.position);
        controllerPosition = Vec3.multiplyQbyV(Quat.inverse(MyAvatar.orientation), controllerPosition);
        return controllerPosition;
    }

    function getDistanceToCamera(position) {
        var cameraPosition = Camera.getPosition();
        var toCameraDistance = Vec3.length(Vec3.subtract(cameraPosition, position));
        return toCameraDistance;
    }
    
    function usePreviousPickRay(pickRayDirection, previousPickRayDirection, normal) {
        return (Vec3.dot(pickRayDirection, normal) > 0 && Vec3.dot(previousPickRayDirection, normal) < 0) ||
               (Vec3.dot(pickRayDirection, normal) < 0 && Vec3.dot(previousPickRayDirection, normal) > 0);
    }

    // @return string - The mode of the currently active tool;
    //                  otherwise, "UNKNOWN" if there's no active tool.
    function getMode() {
        return (activeTool ? activeTool.mode : "UNKNOWN");
    }

    that.cleanup = function() {
        for (var i = 0; i < allOverlays.length; i++) {
            Overlays.deleteOverlay(allOverlays[i]);
        }
        that.clearDebugPickPlane();
    };

    that.select = function(entityID, event) {
        var properties = Entities.getEntityProperties(SelectionManager.selections[0]);

        if (event !== false) {
            var wantDebug = false;
            if (wantDebug) {
                print("select() with EVENT...... ");
                print("                event.y:" + event.y);
                Vec3.print("       current position:", properties.position);
            }
        }

        that.updateHandles();
    };


    /**
     * This callback is used for spaceMode changes.
     * @callback spaceModeChangedCallback
     * @param {string} spaceMode
     */

    /**
     * set this property with a callback to keep track of spaceMode changes.
     * @type {spaceModeChangedCallback}
     */
    that.onSpaceModeChange = null;

    // FUNCTION: SET SPACE MODE
    that.setSpaceMode = function(newSpaceMode, isDesiredChange) {
        var wantDebug = false;
        if (wantDebug) {
            print("======> SetSpaceMode called. ========");
        }

        if (spaceMode !== newSpaceMode) {
            if (wantDebug) {
                print("    Updating SpaceMode From: " + spaceMode + " To: " + newSpaceMode);
            }
            if (isDesiredChange) {
                desiredSpaceMode = newSpaceMode;
            }
            spaceMode = newSpaceMode;

            if (that.onSpaceModeChange !== null) {
                that.onSpaceModeChange(newSpaceMode);
            }

            that.updateHandles();
        } else if (wantDebug) {
            print("WARNING: entitySelectionTool.setSpaceMode - Can't update SpaceMode. CurrentMode: " + 
                  spaceMode + " DesiredMode: " + newSpaceMode);
        }
        if (wantDebug) {
            print("====== SetSpaceMode called. <========");
        }
    };

    // FUNCTION: TOGGLE SPACE MODE
    that.toggleSpaceMode = function() {
        var wantDebug = false;
        if (wantDebug) {
            print("========> ToggleSpaceMode called. =========");
        }
        if ((spaceMode === SPACE_WORLD) && (SelectionManager.selections.length > 1)) {
            if (wantDebug) {
                print("Local space editing is not available with multiple selections");
            }
            return;
        }
        if (wantDebug) {
            print("PreToggle: " + spaceMode);
        }
        that.setSpaceMode((spaceMode === SPACE_LOCAL) ? SPACE_WORLD : SPACE_LOCAL, true);
        if (wantDebug) {
            print("PostToggle: " + spaceMode);        
            print("======== ToggleSpaceMode called. <=========");
        }
    };

    /**
     * Switches the display mode back to the set desired display mode
     */
    that.useDesiredSpaceMode = function() {
        var wantDebug = false;
        if (wantDebug) {
            print("========> UseDesiredSpaceMode called. =========");
        }
        that.setSpaceMode(desiredSpaceMode, false);
        if (wantDebug) {
            print("PostToggle: " + spaceMode);
            print("======== UseDesiredSpaceMode called. <=========");
        }
    };

    /**
     * Get the currently set SpaceMode
     * @returns {string} spaceMode
     */
    that.getSpaceMode = function() {
        return spaceMode;
    };

    function addHandleTool(overlay, tool) {
        handleTools[overlay] = tool;
        return tool;
    }

    // @param: toolHandle:  The overlayID associated with the tool
    //         that correlates to the tool you wish to query.
    // @note: If toolHandle is null or undefined then activeTool
    //        will be checked against those values as opposed to
    //        the tool registered under toolHandle.  Null & Undefined 
    //        are treated as separate values.
    // @return: bool - Indicates if the activeTool is that queried.
    function isActiveTool(toolHandle) {
        if (!toolHandle) {
            // Allow isActiveTool(null) and similar to return true if there's
            // no active tool
            return (activeTool === toolHandle);
        }

        if (!handleTools.hasOwnProperty(toolHandle)) {
            print("WARNING: entitySelectionTool.isActiveTool - Encountered unknown grabberToolHandle: " + 
                  toolHandle + ". Tools should be registered via addHandleTool.");
            // EARLY EXIT
            return false;
        }

        return (activeTool === handleTools[ toolHandle ]);
    }

    // FUNCTION: UPDATE HANDLES
    that.updateHandles = function() {
        var wantDebug = false;
        if (wantDebug) {
            print("======> Update Handles =======");
            print("    Selections Count: " + SelectionManager.selections.length);
            print("    SpaceMode: " + spaceMode);
            print("    DisplayMode: " + getMode());
        }
        
        if (SelectionManager.selections.length === 0) {
            that.setOverlaysVisible(false);
            that.clearDebugPickPlane();
            return;
        }

        if (SelectionManager.hasSelection()) {
            var position = SelectionManager.worldPosition;
            var rotation = spaceMode === SPACE_LOCAL ? SelectionManager.localRotation : SelectionManager.worldRotation;
            var dimensions = spaceMode === SPACE_LOCAL ? SelectionManager.localDimensions : SelectionManager.worldDimensions;
            var rotationInverse = Quat.inverse(rotation);
            var toCameraDistance = getDistanceToCamera(position);

            var rotationDegrees = 90;
            var localRotationX = Quat.fromPitchYawRollDegrees(0, 0, -rotationDegrees);
            var rotationX = Quat.multiply(rotation, localRotationX);
            worldRotationX = rotationX;
            var localRotationY = Quat.fromPitchYawRollDegrees(0, rotationDegrees, 0);
            var rotationY = Quat.multiply(rotation, localRotationY);
            worldRotationY = rotationY;
            var localRotationZ = Quat.fromPitchYawRollDegrees(rotationDegrees, 0, 0);
            var rotationZ = Quat.multiply(rotation, localRotationZ);
            worldRotationZ = rotationZ;
            
            var selectionBoxGeometry = {
                position: position,
                rotation: rotation,
                dimensions: dimensions
            };
            var isCameraInsideBox = isPointInsideBox(Camera.position, selectionBoxGeometry);
            
            // in HMD if outside the bounding box clamp the overlays to the bounding box for now so lasers can hit them
            var maxHandleDimension = 0;
            if (HMD.active && !isCameraInsideBox) {
                maxHandleDimension = Math.max(dimensions.x, dimensions.y, dimensions.z);
            }

            // UPDATE ROTATION RINGS
            // rotateDimension is used as the base dimension for all overlays
            var rotateDimension = Math.max(maxHandleDimension, toCameraDistance * ROTATE_RING_CAMERA_DISTANCE_MULTIPLE);
            var rotateDimensions = { x: rotateDimension, y: rotateDimension, z: rotateDimension };
            if (!isActiveTool(handleRotatePitchRing)) {
                Overlays.editOverlay(handleRotatePitchRing, { 
                    position: position, 
                    rotation: rotationY,
                    dimensions: rotateDimensions,
                    majorTickMarksAngle: ROTATE_DEFAULT_TICK_MARKS_ANGLE
                });
            }
            if (!isActiveTool(handleRotateYawRing)) {
                Overlays.editOverlay(handleRotateYawRing, { 
                    position: position, 
                    rotation: rotationZ,
                    dimensions: rotateDimensions,
                    majorTickMarksAngle: ROTATE_DEFAULT_TICK_MARKS_ANGLE
                });
            }
            if (!isActiveTool(handleRotateRollRing)) {
                Overlays.editOverlay(handleRotateRollRing, { 
                    position: position, 
                    rotation: rotationX,
                    dimensions: rotateDimensions,
                    majorTickMarksAngle: ROTATE_DEFAULT_TICK_MARKS_ANGLE
                });
            }
            Overlays.editOverlay(handleRotateCurrentRing, { dimensions: rotateDimensions });
            that.updateActiveRotateRing();

            // UPDATE TRANSLATION ARROWS
            var arrowCylinderDimension = rotateDimension * TRANSLATE_ARROW_CYLINDER_CAMERA_DISTANCE_MULTIPLE / 
                                                           ROTATE_RING_CAMERA_DISTANCE_MULTIPLE;
            var arrowCylinderDimensions = { 
                x: arrowCylinderDimension, 
                y: arrowCylinderDimension * TRANSLATE_ARROW_CYLINDER_Y_MULTIPLE, 
                z: arrowCylinderDimension 
            };
            var arrowConeDimension = rotateDimension * TRANSLATE_ARROW_CONE_CAMERA_DISTANCE_MULTIPLE / 
                                                       ROTATE_RING_CAMERA_DISTANCE_MULTIPLE;
            var arrowConeDimensions = { x: arrowConeDimension, y: arrowConeDimension, z: arrowConeDimension };
            var arrowCylinderOffset = rotateDimension * TRANSLATE_ARROW_CYLINDER_OFFSET / ROTATE_RING_CAMERA_DISTANCE_MULTIPLE;
            var arrowConeOffset = arrowCylinderDimensions.y * TRANSLATE_ARROW_CONE_OFFSET_CYLINDER_DIMENSION_MULTIPLE;
            var cylinderXPosition = { x: arrowCylinderOffset, y: 0, z: 0 };
            cylinderXPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, cylinderXPosition));
            Overlays.editOverlay(handleTranslateXCylinder, { 
                position: cylinderXPosition, 
                rotation: rotationX,
                dimensions: arrowCylinderDimensions
            });
            var cylinderXOffset = Vec3.subtract(cylinderXPosition, position);
            var coneXPosition = Vec3.sum(cylinderXPosition, Vec3.multiply(Vec3.normalize(cylinderXOffset), arrowConeOffset));
            Overlays.editOverlay(handleTranslateXCone, { 
                position: coneXPosition, 
                rotation: rotationX,
                dimensions: arrowConeDimensions
            });
            var cylinderYPosition = { x: 0, y: arrowCylinderOffset, z: 0 };
            cylinderYPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, cylinderYPosition));
            Overlays.editOverlay(handleTranslateYCylinder, { 
                position: cylinderYPosition, 
                rotation: rotationY,
                dimensions: arrowCylinderDimensions
            });
            var cylinderYOffset = Vec3.subtract(cylinderYPosition, position);
            var coneYPosition = Vec3.sum(cylinderYPosition, Vec3.multiply(Vec3.normalize(cylinderYOffset), arrowConeOffset));
            Overlays.editOverlay(handleTranslateYCone, { 
                position: coneYPosition, 
                rotation: rotationY,
                dimensions: arrowConeDimensions
            });
            var cylinderZPosition = { x: 0, y: 0, z: arrowCylinderOffset };
            cylinderZPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, cylinderZPosition));
            Overlays.editOverlay(handleTranslateZCylinder, { 
                position: cylinderZPosition, 
                rotation: rotationZ,
                dimensions: arrowCylinderDimensions
            });
            var cylinderZOffset = Vec3.subtract(cylinderZPosition, position);
            var coneZPosition = Vec3.sum(cylinderZPosition, Vec3.multiply(Vec3.normalize(cylinderZOffset), arrowConeOffset));
            Overlays.editOverlay(handleTranslateZCone, { 
                position: coneZPosition, 
                rotation: rotationZ,
                dimensions: arrowConeDimensions
            });

            // UPDATE SCALE CUBE
            var scaleCubeRotation = spaceMode === SPACE_LOCAL ? rotation : Quat.IDENTITY;            
            var scaleCubeDimension = rotateDimension * SCALE_OVERLAY_CAMERA_DISTANCE_MULTIPLE / 
                                                       ROTATE_RING_CAMERA_DISTANCE_MULTIPLE;
            var scaleCubeDimensions = { x: scaleCubeDimension, y: scaleCubeDimension, z: scaleCubeDimension };
            Overlays.editOverlay(handleScaleCube, { 
                position: position, 
                rotation: scaleCubeRotation,
                dimensions: scaleCubeDimensions
            });

            // UPDATE BOUNDING BOX
            Overlays.editOverlay(handleBoundingBox, {
                position: position,
                rotation: rotation,
                dimensions: dimensions
            });

            // UPDATE STRETCH HIGHLIGHT PANELS
            var edgeOffsetX = BOUNDING_EDGE_OFFSET * dimensions.x;
            var edgeOffsetY = BOUNDING_EDGE_OFFSET * dimensions.y;
            var edgeOffsetZ = BOUNDING_EDGE_OFFSET * dimensions.z;
            var RBFPosition = { x: edgeOffsetX, y: -edgeOffsetY, z: edgeOffsetZ };
            RBFPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, RBFPosition));
            var RTFPosition = { x: edgeOffsetX, y: edgeOffsetY, z: edgeOffsetZ };
            RTFPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, RTFPosition));
            var LTNPosition = { x: -edgeOffsetX, y: edgeOffsetY, z: -edgeOffsetZ };
            LTNPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, LTNPosition));
            var RTNPosition = { x: edgeOffsetX, y: edgeOffsetY, z: -edgeOffsetZ };
            RTNPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, RTNPosition));

            var RBFPositionRotated = Vec3.multiplyQbyV(rotationInverse, RBFPosition);
            var RTFPositionRotated = Vec3.multiplyQbyV(rotationInverse, RTFPosition);
            var LTNPositionRotated = Vec3.multiplyQbyV(rotationInverse, LTNPosition);
            var RTNPositionRotated = Vec3.multiplyQbyV(rotationInverse, RTNPosition);
            var stretchPanelXDimensions = Vec3.subtract(RTNPositionRotated, RBFPositionRotated);
            var tempY = Math.abs(stretchPanelXDimensions.y);
            stretchPanelXDimensions.x = STRETCH_PANEL_WIDTH;
            stretchPanelXDimensions.y = Math.abs(stretchPanelXDimensions.z);
            stretchPanelXDimensions.z = tempY;
            var stretchPanelXPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, { x: dimensions.x / 2, y: 0, z: 0 }));
            Overlays.editOverlay(handleStretchXPanel, { 
                position: stretchPanelXPosition, 
                rotation: rotationZ,
                dimensions: stretchPanelXDimensions
            });
            var stretchPanelYDimensions = Vec3.subtract(LTNPositionRotated, RTFPositionRotated);
            var tempX = Math.abs(stretchPanelYDimensions.x);
            stretchPanelYDimensions.x = Math.abs(stretchPanelYDimensions.z);
            stretchPanelYDimensions.y = STRETCH_PANEL_WIDTH;
            stretchPanelYDimensions.z = tempX;
            var stretchPanelYPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, { x: 0, y: dimensions.y / 2, z: 0 }));
            Overlays.editOverlay(handleStretchYPanel, { 
                position: stretchPanelYPosition, 
                rotation: rotationY,
                dimensions: stretchPanelYDimensions
            });
            var stretchPanelZDimensions = Vec3.subtract(LTNPositionRotated, RBFPositionRotated);
            tempX = Math.abs(stretchPanelZDimensions.x);
            stretchPanelZDimensions.x = Math.abs(stretchPanelZDimensions.y);
            stretchPanelZDimensions.y = tempX;
            stretchPanelZDimensions.z = STRETCH_PANEL_WIDTH;
            var stretchPanelZPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, { x: 0, y: 0, z: dimensions.z / 2 }));
            Overlays.editOverlay(handleStretchZPanel, { 
                position: stretchPanelZPosition, 
                rotation: rotationX,
                dimensions: stretchPanelZDimensions
            });

            // UPDATE STRETCH CUBES
            var stretchCubeDimension = rotateDimension * STRETCH_CUBE_CAMERA_DISTANCE_MULTIPLE / 
                                                           ROTATE_RING_CAMERA_DISTANCE_MULTIPLE;
            var stretchCubeDimensions = { x: stretchCubeDimension, y: stretchCubeDimension, z: stretchCubeDimension };
            var stretchCubeOffset = rotateDimension * STRETCH_CUBE_OFFSET / ROTATE_RING_CAMERA_DISTANCE_MULTIPLE;
            var stretchXPosition, stretchYPosition, stretchZPosition;
            if (isActiveTool(handleStretchXCube)) {
                stretchXPosition = Vec3.subtract(stretchPanelXPosition, activeStretchCubePanelOffset);
            } else {
                stretchXPosition = { x: stretchCubeOffset, y: 0, z: 0 };
                stretchXPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, stretchXPosition));
            }
            if (isActiveTool(handleStretchYCube)) {
                stretchYPosition = Vec3.subtract(stretchPanelYPosition, activeStretchCubePanelOffset);
            } else {
                stretchYPosition = { x: 0, y: stretchCubeOffset, z: 0 };
                stretchYPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, stretchYPosition));
            }
            if (isActiveTool(handleStretchZCube)) {
                stretchZPosition = Vec3.subtract(stretchPanelZPosition, activeStretchCubePanelOffset);
            } else {
                stretchZPosition = { x: 0, y: 0, z: stretchCubeOffset };
                stretchZPosition = Vec3.sum(position, Vec3.multiplyQbyV(rotation, stretchZPosition));
            }
            Overlays.editOverlay(handleStretchXCube, { 
                position: stretchXPosition, 
                rotation: rotationX,
                dimensions: stretchCubeDimensions 
            });
            Overlays.editOverlay(handleStretchYCube, { 
                position: stretchYPosition, 
                rotation: rotationY,
                dimensions: stretchCubeDimensions 
            });
            Overlays.editOverlay(handleStretchZCube, { 
                position: stretchZPosition,
                rotation: rotationZ,
                dimensions: stretchCubeDimensions 
            });

            // UPDATE SELECTION BOX (CURRENTLY INVISIBLE WITH 0 ALPHA FOR TRANSLATE XZ TOOL)
            var inModeRotate = isActiveTool(handleRotatePitchRing) || 
                               isActiveTool(handleRotateYawRing) || 
                               isActiveTool(handleRotateRollRing);
            selectionBoxGeometry.visible = !inModeRotate && !isCameraInsideBox;
            selectionBoxGeometry.ignorePickIntersection = !selectionBoxGeometry.visible;
            Overlays.editOverlay(selectionBox, selectionBoxGeometry);

            // UPDATE ICON TRANSLATE HANDLE
            if (SelectionManager.entityType === "ParticleEffect" || SelectionManager.entityType === "Light") {
                var iconSelectionBoxGeometry = {
                    position: position,
                    rotation: rotation
                };
                iconSelectionBoxGeometry.visible = !inModeRotate && isCameraInsideBox;
                iconSelectionBoxGeometry.ignorePickIntersection = !iconSelectionBoxGeometry.visible;
                Overlays.editOverlay(iconSelectionBox, iconSelectionBoxGeometry);
            } else {
                Overlays.editOverlay(iconSelectionBox, {
                    visible: false,
                    ignorePickIntersection: true
                });
            }

            // UPDATE DUPLICATOR (CURRENTLY HIDDEN FOR NOW)
            var handleDuplicatorOffset = { 
                x: DUPLICATOR_OFFSET.x * dimensions.x, 
                y: DUPLICATOR_OFFSET.y * dimensions.y, 
                z: DUPLICATOR_OFFSET.z * dimensions.z 
            };
            var handleDuplicatorPos = Vec3.sum(position, Vec3.multiplyQbyV(rotation, handleDuplicatorOffset));
            Overlays.editOverlay(handleDuplicator, {
                position: handleDuplicatorPos,
                rotation: rotation,
                dimensions: scaleCubeDimensions
            });
        }

        that.setHandleTranslateXVisible(!activeTool || isActiveTool(handleTranslateXCone) || 
                                                       isActiveTool(handleTranslateXCylinder));
        that.setHandleTranslateYVisible(!activeTool || isActiveTool(handleTranslateYCone) || 
                                                       isActiveTool(handleTranslateYCylinder));
        that.setHandleTranslateZVisible(!activeTool || isActiveTool(handleTranslateZCone) || 
                                                       isActiveTool(handleTranslateZCylinder));
        that.setHandleRotatePitchVisible(!activeTool || isActiveTool(handleRotatePitchRing));
        that.setHandleRotateYawVisible(!activeTool || isActiveTool(handleRotateYawRing));
        that.setHandleRotateRollVisible(!activeTool || isActiveTool(handleRotateRollRing));

        var showScaleStretch = !activeTool && SelectionManager.selections.length === 1 && spaceMode === SPACE_LOCAL;
        that.setHandleStretchXVisible(showScaleStretch || isActiveTool(handleStretchXCube));
        that.setHandleStretchYVisible(showScaleStretch || isActiveTool(handleStretchYCube));
        that.setHandleStretchZVisible(showScaleStretch || isActiveTool(handleStretchZCube));
        that.setHandleScaleVisible(showScaleStretch || isActiveTool(handleScaleCube));

        var showOutlineForZone = (SelectionManager.selections.length === 1 && 
                                    typeof SelectionManager.savedProperties[SelectionManager.selections[0]] !== "undefined" &&
                                    SelectionManager.savedProperties[SelectionManager.selections[0]].type === "Zone");
        that.setHandleBoundingBoxVisible(showOutlineForZone || (!isActiveTool(handleRotatePitchRing) &&
                                                              !isActiveTool(handleRotateYawRing) &&
                                                              !isActiveTool(handleRotateRollRing)));

        // keep duplicator always hidden for now since you can hold Alt to duplicate while
        // translating an entity - we may bring duplicator back for HMD only later
        // that.setHandleDuplicatorVisible(!activeTool || isActiveTool(handleDuplicator));

        if (wantDebug) {
            print("====== Update Handles <=======");
        }
    };
    Script.update.connect(that.updateHandles);

    // FUNCTION: UPDATE ACTIVE ROTATE RING
    that.updateActiveRotateRing = function() {
        var activeRotateRing = null;
        if (isActiveTool(handleRotatePitchRing)) {
            activeRotateRing = handleRotatePitchRing;
        } else if (isActiveTool(handleRotateYawRing)) {
            activeRotateRing = handleRotateYawRing;
        } else if (isActiveTool(handleRotateRollRing)) {
            activeRotateRing = handleRotateRollRing;
        }
        if (activeRotateRing !== null) {
            var tickMarksAngle = ctrlPressed ? ROTATE_CTRL_SNAP_ANGLE : ROTATE_DEFAULT_TICK_MARKS_ANGLE;
            Overlays.editOverlay(activeRotateRing, { majorTickMarksAngle: tickMarksAngle });
        }
    };

    // FUNCTION: SET OVERLAYS VISIBLE
    that.setOverlaysVisible = function(isVisible) {
        for (var i = 0, length = allOverlays.length; i < length; i++) {
            Overlays.editOverlay(allOverlays[i], { visible: isVisible, ignorePickIntersection: !isVisible });
        }
    };

    // FUNCTION: SET HANDLE TRANSLATE VISIBLE
    that.setHandleTranslateVisible = function(isVisible) {
        that.setHandleTranslateXVisible(isVisible);
        that.setHandleTranslateYVisible(isVisible);
        that.setHandleTranslateZVisible(isVisible);
    };

    that.setHandleTranslateXVisible = function(isVisible) {
        Overlays.editOverlay(handleTranslateXCone, { visible: isVisible, ignorePickIntersection: !isVisible });
        Overlays.editOverlay(handleTranslateXCylinder, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    that.setHandleTranslateYVisible = function(isVisible) {
        Overlays.editOverlay(handleTranslateYCone, { visible: isVisible, ignorePickIntersection: !isVisible });
        Overlays.editOverlay(handleTranslateYCylinder, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    that.setHandleTranslateZVisible = function(isVisible) {
        Overlays.editOverlay(handleTranslateZCone, { visible: isVisible, ignorePickIntersection: !isVisible });
        Overlays.editOverlay(handleTranslateZCylinder, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    // FUNCTION: SET HANDLE ROTATE VISIBLE
    that.setHandleRotateVisible = function(isVisible) {
        that.setHandleRotatePitchVisible(isVisible);
        that.setHandleRotateYawVisible(isVisible);
        that.setHandleRotateRollVisible(isVisible);
    };

    that.setHandleRotatePitchVisible = function(isVisible) {
        Overlays.editOverlay(handleRotatePitchRing, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    that.setHandleRotateYawVisible = function(isVisible) {
        Overlays.editOverlay(handleRotateYawRing, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    that.setHandleRotateRollVisible = function(isVisible) {
        Overlays.editOverlay(handleRotateRollRing, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    // FUNCTION: SET HANDLE STRETCH VISIBLE
    that.setHandleStretchVisible = function(isVisible) {
        that.setHandleStretchXVisible(isVisible);
        that.setHandleStretchYVisible(isVisible);
        that.setHandleStretchZVisible(isVisible);
    };

    that.setHandleStretchXVisible = function(isVisible) {
        Overlays.editOverlay(handleStretchXCube, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    that.setHandleStretchYVisible = function(isVisible) {
        Overlays.editOverlay(handleStretchYCube, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    that.setHandleStretchZVisible = function(isVisible) {
        Overlays.editOverlay(handleStretchZCube, { visible: isVisible, ignorePickIntersection: !isVisible });
    };
    
    // FUNCTION: SET HANDLE SCALE VISIBLE
    that.setHandleScaleVisible = function(isVisible) {
        that.setHandleScaleVisible(isVisible);
        that.setHandleBoundingBoxVisible(isVisible);
    };

    that.setHandleScaleVisible = function(isVisible) {
        Overlays.editOverlay(handleScaleCube, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    that.setHandleBoundingBoxVisible = function(isVisible) {
        Overlays.editOverlay(handleBoundingBox, { visible: isVisible, ignorePickIntersection: true });
    };

    // FUNCTION: SET HANDLE DUPLICATOR VISIBLE
    that.setHandleDuplicatorVisible = function(isVisible) {
        Overlays.editOverlay(handleDuplicator, { visible: isVisible, ignorePickIntersection: !isVisible });
    };

    // FUNCTION: DEBUG PICK PLANE
    that.showDebugPickPlane = function(pickPlanePosition, pickPlaneNormal) {
        var planePlusNormal = Vec3.sum(pickPlanePosition, pickPlaneNormal);
        var rotation = Quat.lookAtSimple(planePlusNormal, pickPlanePosition);
        var dimensionXZ = getDistanceToCamera(pickPlanePosition) * 1.25;   
        var dimensions = { x:dimensionXZ, y:dimensionXZ, z:STRETCH_PANEL_WIDTH };
        Overlays.editOverlay(debugPickPlane, {
            position: pickPlanePosition,
            rotation: rotation,
            dimensions: dimensions,
            visible: true
        });
    };
    
    that.showDebugPickPlaneHit = function(pickHitPosition) {
        var dimension = getDistanceToCamera(pickHitPosition) * DEBUG_PICK_PLANE_HIT_CAMERA_DISTANCE_MULTIPLE;
        var pickPlaneHit = Overlays.addOverlay("shape", {
            alpha: 0.5,
            shape: "Sphere",
            solid: true,
            visible: true,
            ignorePickIntersection: true,
            drawInFront: false,
            color: COLOR_DEBUG_PICK_PLANE_HIT,
            position: pickHitPosition,
            dimensions: { x: dimension, y: dimension, z: dimension }
        });
        debugPickPlaneHits.push(pickPlaneHit);
        if (debugPickPlaneHits.length > DEBUG_PICK_PLANE_HIT_LIMIT) {
            var removedPickPlaneHit = debugPickPlaneHits.shift();
            Overlays.deleteOverlay(removedPickPlaneHit);
        }
    };
    
    that.clearDebugPickPlane = function() {
        Overlays.editOverlay(debugPickPlane, { visible: false });
        for (var i = 0; i < debugPickPlaneHits.length; i++) {
            Overlays.deleteOverlay(debugPickPlaneHits[i]);
        }
        debugPickPlaneHits = [];
    };
    
    // TOOL DEFINITION: HANDLE TRANSLATE XZ TOOL
    function addHandleTranslateXZTool(overlay, mode, doDuplicate) {
        var initialPick = null;
        var isConstrained = false;
        var constrainMajorOnly = false;
        var startPosition = null;
        var duplicatedEntityIDs = null;
        var pickPlanePosition = null;
        var pickPlaneNormal = { x: 0, y: 1, z: 0 };
        var greatestDimension = 0.0;
        var startingDistance = 0.0;
        var startingElevation = 0.0;
        addHandleTool(overlay, {
            mode: mode,
            onBegin: function(event, pickRay, pickResult) {
                var wantDebug = false;
                if (wantDebug) {
                    print("================== TRANSLATE_XZ(Beg) -> =======================");
                    Vec3.print("    pickRay", pickRay);
                    Vec3.print("    pickRay.origin", pickRay.origin);
                    Vec3.print("    pickResult.intersection", pickResult.intersection);
                }

                // Duplicate entities if alt is pressed.  This will make a
                // copy of the selected entities and move the _original_ entities, not
                // the new ones.
                if (event.isAlt || doDuplicate) {
                    duplicatedEntityIDs = SelectionManager.duplicateSelection();
                    var ids = [];
                    for (var i = 0; i < duplicatedEntityIDs.length; ++i) {
                        ids.push(duplicatedEntityIDs[i].entityID);
                    }
                    SelectionManager.setSelections(ids);
                } else {
                    duplicatedEntityIDs = null;
                }

                SelectionManager.saveProperties();
                that.resetPreviousHandleColor();

                that.setHandleTranslateVisible(false);
                that.setHandleRotateVisible(false);
                that.setHandleScaleVisible(false);
                that.setHandleStretchVisible(false);
                that.setHandleDuplicatorVisible(false);

                startPosition = SelectionManager.worldPosition;
                pickPlanePosition = pickResult.intersection;
                greatestDimension = Math.max(Math.max(SelectionManager.worldDimensions.x, 
                                                      SelectionManager.worldDimensions.y),
                                                      SelectionManager.worldDimensions.z);
                startingDistance = Vec3.distance(pickRay.origin, SelectionManager.position);
                startingElevation = this.elevation(pickRay.origin, pickPlanePosition);
                if (wantDebug) {
                    print("    longest dimension: " + greatestDimension);
                    print("    starting distance: " + startingDistance);
                    print("    starting elevation: " + startingElevation);
                }

                initialPick = rayPlaneIntersection(pickRay, pickPlanePosition, pickPlaneNormal);
                
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlane(pickPlanePosition, pickPlaneNormal);
                    that.showDebugPickPlaneHit(initialPick);
                }

                isConstrained = false;
                if (wantDebug) {
                    print("================== TRANSLATE_XZ(End) <- =======================");
                }
            },
            onEnd: function(event, reason) {
                pushCommandForSelections(duplicatedEntityIDs);
                if (isConstrained) {
                    Overlays.editOverlay(xRailOverlay, {
                        visible: false,
                        ignorePickIntersection: true
                    });
                    Overlays.editOverlay(zRailOverlay, {
                        visible: false,
                        ignorePickIntersection: true
                    });
                }
            },
            elevation: function(origin, intersection) {
                return (origin.y - intersection.y) / Vec3.distance(origin, intersection);
            },
            onMove: function(event) {
                var wantDebug = false;
                var pickRay = generalComputePickRay(event.x, event.y);

                var newPick = rayPlaneIntersection2(pickRay, pickPlanePosition, pickPlaneNormal);

                // If the pick ray doesn't hit the pick plane in this direction, do nothing.
                // this will happen when someone drags across the horizon from the side they started on.
                if (!newPick) {
                    if (wantDebug) {
                        print("    "+ mode + "Pick ray does not intersect XZ plane.");
                    }
                    
                    // EARLY EXIT--(Invalid ray detected.)
                    return;
                }
                
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlaneHit(newPick);
                }

                var vector = Vec3.subtract(newPick, initialPick);

                // If the mouse is too close to the horizon of the pick plane, stop moving
                var MIN_ELEVATION = 0.02; //  largest dimension of object divided by distance to it
                var elevation = this.elevation(pickRay.origin, newPick);
                if (wantDebug) {
                    print("Start Elevation: " + startingElevation + ", elevation: " + elevation);
                }
                if ((startingElevation > 0.0 && elevation < MIN_ELEVATION) ||
                    (startingElevation < 0.0 && elevation > -MIN_ELEVATION)) {
                    if (wantDebug) {
                        print("    "+ mode + " - too close to horizon!");
                    }

                    // EARLY EXIT--(Don't proceed past the reached limit.)
                    return;
                }

                //  If the angular size of the object is too small, stop moving
                var MIN_ANGULAR_SIZE = 0.01; //  Radians
                if (greatestDimension > 0) {
                    var angularSize = Math.atan(greatestDimension / Vec3.distance(pickRay.origin, newPick));
                    if (wantDebug) {
                        print("Angular size = " + angularSize);
                    }
                    if (angularSize < MIN_ANGULAR_SIZE) {
                        return;
                    }
                }

                // If shifted, constrain to one axis
                if (event.isShifted) {
                    if (Math.abs(vector.x) > Math.abs(vector.z)) {
                        vector.z = 0;
                    } else {
                        vector.x = 0;
                    }
                    if (!isConstrained) {
                        var xStart = Vec3.sum(startPosition, {
                            x: -RAIL_AXIS_LENGTH,
                            y: 0,
                            z: 0
                        });
                        var xEnd = Vec3.sum(startPosition, {
                            x: RAIL_AXIS_LENGTH,
                            y: 0,
                            z: 0
                        });
                        var zStart = Vec3.sum(startPosition, {
                            x: 0,
                            y: 0,
                            z: -RAIL_AXIS_LENGTH
                        });
                        var zEnd = Vec3.sum(startPosition, {
                            x: 0,
                            y: 0,
                            z: RAIL_AXIS_LENGTH
                        });
                        Overlays.editOverlay(xRailOverlay, {
                            start: xStart,
                            end: xEnd,
                            visible: true,
                            ignorePickIntersection: true
                        });
                        Overlays.editOverlay(zRailOverlay, {
                            start: zStart,
                            end: zEnd,
                            visible: true,
                            ignorePickIntersection: true
                        });
                        isConstrained = true;
                    }
                } else {
                    if (isConstrained) {
                        Overlays.editOverlay(xRailOverlay, {
                            visible: false,
                            ignorePickIntersection: true
                        });
                        Overlays.editOverlay(zRailOverlay, {
                            visible: false,
                            ignorePickIntersection: true
                        });
                        isConstrained = false;
                    }
                }

                constrainMajorOnly = event.isControl;
                var negateAndHalve = -0.5;
                var cornerPosition = Vec3.sum(startPosition, Vec3.multiply(negateAndHalve, SelectionManager.worldDimensions));
                vector = Vec3.subtract(
                    grid.snapToGrid(Vec3.sum(cornerPosition, vector), constrainMajorOnly),
                    cornerPosition);

                // editing a parent will cause all the children to automatically follow along, so don't
                // edit any entity who has an ancestor in SelectionManager.selections
                var toMove = SelectionManager.selections.filter(function (selection) {
                    if (SelectionManager.selections.indexOf(SelectionManager.savedProperties[selection].parentID) >= 0) {
                        return false; // a parent is also being moved, so don't issue an edit for this entity
                    } else {
                        return true;
                    }
                });

                for (var i = 0; i < toMove.length; i++) {
                    var properties = SelectionManager.savedProperties[toMove[i]];
                    if (!properties) {
                        continue;
                    }
                    var newPosition = Vec3.sum(properties.position, {
                        x: vector.x,
                        y: 0,
                        z: vector.z
                    });
                    Entities.editEntity(toMove[i], {
                        position: newPosition
                    });

                    if (wantDebug) {
                        print("translateXZ... ");
                        Vec3.print("                 vector:", vector);
                        Vec3.print("            newPosition:", properties.position);
                        Vec3.print("            newPosition:", newPosition);
                    }
                }

                SelectionManager._update(false, this);
            }
        });
    }

    // TOOL DEFINITION: HANDLE TRANSLATE TOOL    
    function addHandleTranslateTool(overlay, mode, direction) {
        var pickPlanePosition = null;
        var pickPlaneNormal = null;
        var initialPick = null;
        var projectionVector = null;
        var previousPickRay = null;
        var rotation = null;
        addHandleTool(overlay, {
            mode: mode,
            onBegin: function(event, pickRay, pickResult) {
                // Duplicate entities if alt is pressed.  This will make a
                // copy of the selected entities and move the _original_ entities, not
                // the new ones.
                if (event.isAlt) {
                    duplicatedEntityIDs = SelectionManager.duplicateSelection();
                    var ids = [];
                    for (var i = 0; i < duplicatedEntityIDs.length; ++i) {
                        ids.push(duplicatedEntityIDs[i].entityID);
                    }
                    SelectionManager.setSelections(ids);
                } else {
                    duplicatedEntityIDs = null;
                }

                var axisVector;
                if (direction === TRANSLATE_DIRECTION.X) {
                    axisVector = { x: 1, y: 0, z: 0 };
                } else if (direction === TRANSLATE_DIRECTION.Y) {
                    axisVector = { x: 0, y: 1, z: 0 };
                } else if (direction === TRANSLATE_DIRECTION.Z) {
                    axisVector = { x: 0, y: 0, z: 1 };
                }
                
                rotation = spaceMode === SPACE_LOCAL ? SelectionManager.localRotation : SelectionManager.worldRotation;
                axisVector = Vec3.multiplyQbyV(rotation, axisVector);
                pickPlaneNormal = Vec3.cross(Vec3.cross(pickRay.direction, axisVector), axisVector);
                pickPlanePosition = SelectionManager.worldPosition;
                initialPick = rayPlaneIntersection(pickRay, pickPlanePosition, pickPlaneNormal);
    
                SelectionManager.saveProperties();
                that.resetPreviousHandleColor();

                that.setHandleTranslateXVisible(direction === TRANSLATE_DIRECTION.X);
                that.setHandleTranslateYVisible(direction === TRANSLATE_DIRECTION.Y);
                that.setHandleTranslateZVisible(direction === TRANSLATE_DIRECTION.Z);
                that.setHandleRotateVisible(false);
                that.setHandleStretchVisible(false);
                that.setHandleScaleVisible(false);
                that.setHandleDuplicatorVisible(false);
                
                previousPickRay = pickRay;
                
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlane(pickPlanePosition, pickPlaneNormal);
                    that.showDebugPickPlaneHit(initialPick);
                }
            },
            onEnd: function(event, reason) {
                pushCommandForSelections(duplicatedEntityIDs);
            },
            onMove: function(event) {
                var pickRay = generalComputePickRay(event.x, event.y);
                
                // Use previousPickRay if new pickRay will cause resulting rayPlaneIntersection values to wrap around
                if (usePreviousPickRay(pickRay.direction, previousPickRay.direction, pickPlaneNormal)) {
                    pickRay = previousPickRay;
                }
    
                var newPick = rayPlaneIntersection(pickRay, pickPlanePosition, pickPlaneNormal);
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlaneHit(newPick);
                }
                
                var vector = Vec3.subtract(newPick, initialPick);
                
                if (direction === TRANSLATE_DIRECTION.X) {
                    projectionVector = { x: 1, y: 0, z: 0 };
                } else if (direction === TRANSLATE_DIRECTION.Y) {
                    projectionVector = { x: 0, y: 1, z: 0 };
                } else if (direction === TRANSLATE_DIRECTION.Z) {
                    projectionVector = { x: 0, y: 0, z: 1 };
                }
                projectionVector = Vec3.multiplyQbyV(rotation, projectionVector);

                var dotVector = Vec3.dot(vector, projectionVector);
                vector = Vec3.multiply(dotVector, projectionVector);
                var gridOrigin = grid.getOrigin();
                vector = Vec3.subtract(grid.snapToGrid(Vec3.sum(vector, gridOrigin)), gridOrigin);
                
                var wantDebug = false;
                if (wantDebug) {
                    print("translateUpDown... ");
                    print("                event.y:" + event.y);
                    Vec3.print("        newIntersection:", newIntersection);
                    Vec3.print("                 vector:", vector);
                }

                // editing a parent will cause all the children to automatically follow along, so don't
                // edit any entity who has an ancestor in SelectionManager.selections
                var toMove = SelectionManager.selections.filter(function (selection) {
                    if (SelectionManager.selections.indexOf(SelectionManager.savedProperties[selection].parentID) >= 0) {
                        return false; // a parent is also being moved, so don't issue an edit for this entity
                    } else {
                        return true;
                    }
                });

                for (var i = 0; i < toMove.length; i++) {
                    var id = toMove[i];
                    var properties = SelectionManager.savedProperties[id];
                    var newPosition = Vec3.sum(properties.position, vector);
                    Entities.editEntity(id, { position: newPosition });
                }
                
                previousPickRay = pickRay;
    
                SelectionManager._update(false, this);
            }
        });
    }

    // TOOL DEFINITION: HANDLE STRETCH TOOL   
    function addHandleStretchTool(overlay, mode, directionEnum) {
        var initialPick = null;
        var initialPosition = null;
        var initialDimensions = null;
        var rotation = null;
        var registrationPoint = null;
        var pickPlanePosition = null;
        var pickPlaneNormal = null;
        var previousPickRay = null;
        var directionVector = null;
        var axisVector = null;
        var signs = null;
        var mask = null;
        var stretchPanel = null;
        var handleStretchCube = null;
        var deltaPivot = null;
        addHandleTool(overlay, {
            mode: mode,
            onBegin: function(event, pickRay, pickResult) {             
                if (directionEnum === STRETCH_DIRECTION.X) {
                    stretchPanel = handleStretchXPanel;
                    handleStretchCube = handleStretchXCube;
                    directionVector = { x: -1, y: 0, z: 0 };
                } else if (directionEnum === STRETCH_DIRECTION.Y) {
                    stretchPanel = handleStretchYPanel;
                    handleStretchCube = handleStretchYCube;
                    directionVector = { x: 0, y: -1, z: 0 };
                } else if (directionEnum === STRETCH_DIRECTION.Z) {
                    stretchPanel = handleStretchZPanel;
                    handleStretchCube = handleStretchZCube;
                    directionVector = { x: 0, y: 0, z: -1 };
                }
                
                rotation = SelectionManager.localRotation;
                initialPosition = SelectionManager.localPosition;
                initialDimensions = SelectionManager.localDimensions;
                registrationPoint = SelectionManager.localRegistrationPoint;
                
                axisVector = Vec3.multiply(NEGATE_VECTOR, directionVector);
                axisVector = Vec3.multiplyQbyV(rotation, axisVector);
                
                signs = {
                    x: directionVector.x < 0 ? -1 : (directionVector.x > 0 ? 1 : 0),
                    y: directionVector.y < 0 ? -1 : (directionVector.y > 0 ? 1 : 0),
                    z: directionVector.z < 0 ? -1 : (directionVector.z > 0 ? 1 : 0)
                };
                mask = {
                    x: Math.abs(directionVector.x) > 0 ? 1 : 0,
                    y: Math.abs(directionVector.y) > 0 ? 1 : 0,
                    z: Math.abs(directionVector.z) > 0 ? 1 : 0
                };
                
                var pivot = directionVector;
                var offset = Vec3.multiply(directionVector, NEGATE_VECTOR);
                
                // Modify range of registrationPoint to be [-0.5, 0.5]
                var centeredRP = Vec3.subtract(registrationPoint, {
                    x: 0.5,
                    y: 0.5,
                    z: 0.5
                });

                // Scale pivot to be in the same range as registrationPoint
                var scaledPivot = Vec3.multiply(0.5, pivot);
                deltaPivot = Vec3.subtract(centeredRP, scaledPivot);

                var scaledOffset = Vec3.multiply(0.5, offset);

                // Offset from the registration point
                var offsetRP = Vec3.subtract(scaledOffset, centeredRP);

                // Scaled offset in world coordinates
                var scaledOffsetWorld = Vec3.multiplyVbyV(initialDimensions, offsetRP);
                
                pickPlaneNormal = Vec3.cross(Vec3.cross(pickRay.direction, axisVector), axisVector);
                pickPlanePosition = Vec3.sum(initialPosition, Vec3.multiplyQbyV(rotation, scaledOffsetWorld));
                initialPick = rayPlaneIntersection(pickRay, pickPlanePosition, pickPlaneNormal);

                that.setHandleTranslateVisible(false);
                that.setHandleRotateVisible(false);
                that.setHandleScaleVisible(true);
                that.setHandleStretchXVisible(directionEnum === STRETCH_DIRECTION.X);
                that.setHandleStretchYVisible(directionEnum === STRETCH_DIRECTION.Y);
                that.setHandleStretchZVisible(directionEnum === STRETCH_DIRECTION.Z);
                that.setHandleDuplicatorVisible(false);
            
                SelectionManager.saveProperties();
                that.resetPreviousHandleColor();

                var collisionToRemove = "myAvatar";
                var properties = Entities.getEntityProperties(SelectionManager.selections[0]);
                if (properties.collidesWith.indexOf(collisionToRemove) > -1) {
                    var newCollidesWith = properties.collidesWith.replace(collisionToRemove, "");
                    Entities.editEntity(SelectionManager.selections[0], {collidesWith: newCollidesWith});
                    that.replaceCollisionsAfterStretch = true;
                }

                if (stretchPanel !== null) {
                    Overlays.editOverlay(stretchPanel, { visible: true, ignorePickIntersection: false });
                }
                var stretchCubePosition = Overlays.getProperty(handleStretchCube, "position");
                var stretchPanelPosition = Overlays.getProperty(stretchPanel, "position");
                activeStretchCubePanelOffset = Vec3.subtract(stretchPanelPosition, stretchCubePosition);
                
                previousPickRay = pickRay;

                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlane(pickPlanePosition, pickPlaneNormal);
                    that.showDebugPickPlaneHit(initialPick);
                }
            },
            onEnd: function(event, reason) {                
                if (that.replaceCollisionsAfterStretch) {
                    var newCollidesWith = SelectionManager.savedProperties[SelectionManager.selections[0]].collidesWith;
                    Entities.editEntity(SelectionManager.selections[0], {collidesWith: newCollidesWith});
                    that.replaceCollisionsAfterStretch = false;
                }
                
                if (stretchPanel !== null) {
                    Overlays.editOverlay(stretchPanel, { visible: false, ignorePickIntersection: true });
                }
                activeStretchCubePanelOffset = null;
                
                pushCommandForSelections();
            },
            onMove: function(event) {            
                var pickRay = generalComputePickRay(event.x, event.y);
                
                // Use previousPickRay if new pickRay will cause resulting rayPlaneIntersection values to wrap around
                if (usePreviousPickRay(pickRay.direction, previousPickRay.direction, pickPlaneNormal)) {
                    pickRay = previousPickRay;
                }
                
                var newPick = rayPlaneIntersection(pickRay, pickPlanePosition, pickPlaneNormal);
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlaneHit(newPick);
                }
                
                var changeInDimensions = Vec3.subtract(newPick, initialPick);
                var dotVector = Vec3.dot(changeInDimensions, axisVector);
                changeInDimensions = Vec3.multiply(dotVector, axisVector);
                changeInDimensions = Vec3.multiplyQbyV(Quat.inverse(rotation), changeInDimensions);
                changeInDimensions = Vec3.multiplyVbyV(mask, changeInDimensions);
                changeInDimensions = grid.snapToSpacing(changeInDimensions);
                changeInDimensions = Vec3.multiply(NEGATE_VECTOR, Vec3.multiplyVbyV(signs, changeInDimensions));    

                var newDimensions = Vec3.sum(initialDimensions, changeInDimensions);

                var minimumDimension = Entities.getPropertyInfo("dimensions").minimum; 
                if (newDimensions.x < minimumDimension) {
                    newDimensions.x = minimumDimension;
                    changeInDimensions.x = minimumDimension - initialDimensions.x;
                }
                if (newDimensions.y < minimumDimension) {
                    newDimensions.y = minimumDimension;
                    changeInDimensions.y = minimumDimension - initialDimensions.y;
                }
                if (newDimensions.z < minimumDimension) {
                    newDimensions.z = minimumDimension;
                    changeInDimensions.z = minimumDimension - initialDimensions.z;
                }

                var changeInPosition = Vec3.multiplyQbyV(rotation, Vec3.multiplyVbyV(deltaPivot, changeInDimensions));
                var newPosition = Vec3.sum(initialPosition, changeInPosition);
        
                Entities.editEntity(SelectionManager.selections[0], {
                    position: newPosition,
                    dimensions: newDimensions
                });
                    
                var wantDebug = false;
                if (wantDebug) {
                    print(mode);
                    Vec3.print("            changeInDimensions:", changeInDimensions);
                    Vec3.print("                 newDimensions:", newDimensions);
                    Vec3.print("              changeInPosition:", changeInPosition);
                    Vec3.print("                   newPosition:", newPosition);
                }
                
                previousPickRay = pickRay;
        
                SelectionManager._update(false, this);
            }
        });
    }

    // TOOL DEFINITION: HANDLE SCALE TOOL   
    function addHandleScaleTool(overlay, mode) {
        var initialPick = null;
        var initialPosition = null;
        var initialDimensions = null;
        var pickPlanePosition = null;
        var pickPlaneNormal = null;
        var previousPickRay = null;     
        addHandleTool(overlay, {
            mode: mode,
            onBegin: function(event, pickRay, pickResult) {
                initialPosition = SelectionManager.localPosition;
                initialDimensions = SelectionManager.localDimensions;               
                
                pickPlanePosition = initialPosition;                
                pickPlaneNormal = Vec3.subtract(pickRay.origin, pickPlanePosition);
                initialPick = rayPlaneIntersection(pickRay, pickPlanePosition, pickPlaneNormal);

                that.setHandleTranslateVisible(false);
                that.setHandleRotateVisible(false);
                that.setHandleScaleVisible(true);
                that.setHandleStretchVisible(false);
                that.setHandleDuplicatorVisible(false);
            
                SelectionManager.saveProperties();
                that.resetPreviousHandleColor();

                var collisionToRemove = "myAvatar";
                var properties = Entities.getEntityProperties(SelectionManager.selections[0]);
                if (properties.collidesWith.indexOf(collisionToRemove) > -1) {
                    var newCollidesWith = properties.collidesWith.replace(collisionToRemove, "");
                    Entities.editEntity(SelectionManager.selections[0], {collidesWith: newCollidesWith});
                    that.replaceCollisionsAfterStretch = true;
                }

                previousPickRay = pickRay;
                
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlane(pickPlanePosition, pickPlaneNormal);
                    that.showDebugPickPlaneHit(initialPick);
                }
            },
            onEnd: function(event, reason) {                
                if (that.replaceCollisionsAfterStretch) {
                    var newCollidesWith = SelectionManager.savedProperties[SelectionManager.selections[0]].collidesWith;
                    Entities.editEntity(SelectionManager.selections[0], {collidesWith: newCollidesWith});
                    that.replaceCollisionsAfterStretch = false;
                }
                
                pushCommandForSelections();
            },
            onMove: function(event) {            
                var pickRay = generalComputePickRay(event.x, event.y);
                
                // Use previousPickRay if new pickRay will cause resulting rayPlaneIntersection values to wrap around
                if (usePreviousPickRay(pickRay.direction, previousPickRay.direction, pickPlaneNormal)) {
                    pickRay = previousPickRay;
                }
                
                var newPick = rayPlaneIntersection(pickRay, pickPlanePosition, pickPlaneNormal);
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlaneHit(newPick);
                }
                
                var toCameraDistance = getDistanceToCamera(initialPosition);  
                var dimensionsMultiple = toCameraDistance * SCALE_DIMENSIONS_CAMERA_DISTANCE_MULTIPLE;
                var changeInDimensions = Vec3.subtract(newPick, initialPick);                   
                changeInDimensions = Vec3.multiplyQbyV(Quat.inverse(Camera.orientation), changeInDimensions);
                changeInDimensions = grid.snapToSpacing(changeInDimensions);
                changeInDimensions = Vec3.multiply(changeInDimensions, dimensionsMultiple);
                
                var averageDimensionChange = (changeInDimensions.x + changeInDimensions.y + changeInDimensions.z) / 3;
                var averageInitialDimension = (initialDimensions.x + initialDimensions.y + initialDimensions.z) / 3;
                percentChange = averageDimensionChange / averageInitialDimension;
                percentChange += 1.0;
                
                var newDimensions = Vec3.multiply(percentChange, initialDimensions);
                newDimensions.x = Math.abs(newDimensions.x);
                newDimensions.y = Math.abs(newDimensions.y);
                newDimensions.z = Math.abs(newDimensions.z);

                var minimumDimension = Entities.getPropertyInfo("dimensions").minimum; 
                if (newDimensions.x < minimumDimension) {
                    newDimensions.x = minimumDimension;
                    changeInDimensions.x = minimumDimension - initialDimensions.x;
                }
                if (newDimensions.y < minimumDimension) {
                    newDimensions.y = minimumDimension;
                    changeInDimensions.y = minimumDimension - initialDimensions.y;
                }
                if (newDimensions.z < minimumDimension) {
                    newDimensions.z = minimumDimension;
                    changeInDimensions.z = minimumDimension - initialDimensions.z;
                }
                
                Entities.editEntity(SelectionManager.selections[0], { dimensions: newDimensions });
                    
                var wantDebug = false;
                if (wantDebug) {
                    print(mode);
                    Vec3.print("            changeInDimensions:", changeInDimensions);
                    Vec3.print("                 newDimensions:", newDimensions);
                }
                
                previousPickRay = pickRay;
        
                SelectionManager._update(false, this);
            }
        });
    }

    // FUNCTION: UPDATE ROTATION DEGREES OVERLAY
    function updateRotationDegreesOverlay(angleFromZero, position) {
        var toCameraDistance = getDistanceToCamera(position);
        var overlayProps = {
            position: position,
            dimensions: {
                x: toCameraDistance * ROTATE_DISPLAY_SIZE_X_MULTIPLIER,
                y: toCameraDistance * ROTATE_DISPLAY_SIZE_Y_MULTIPLIER
            },
            lineHeight: toCameraDistance * ROTATE_DISPLAY_LINE_HEIGHT_MULTIPLIER,
            text: normalizeDegrees(-angleFromZero) + "°"
        };
        Overlays.editOverlay(rotationDegreesDisplay, overlayProps);
    }

    // FUNCTION DEF: updateSelectionsRotation
    //    Helper func used by rotation handle tools 
    function updateSelectionsRotation(rotationChange, initialPosition) {
        if (!rotationChange) {
            print("ERROR: entitySelectionTool.updateSelectionsRotation - Invalid arg specified!!");

            // EARLY EXIT
            return;
        }

        // Entities should only reposition if we are rotating multiple selections around
        // the selections center point.  Otherwise, the rotation will be around the entities
        // registration point which does not need repositioning.
        var reposition = (SelectionManager.selections.length > 1);

        // editing a parent will cause all the children to automatically follow along, so don't
        // edit any entity who has an ancestor in SelectionManager.selections
        var toRotate = SelectionManager.selections.filter(function (selection) {
            if (SelectionManager.selections.indexOf(SelectionManager.savedProperties[selection].parentID) >= 0) {
                return false; // a parent is also being moved, so don't issue an edit for this entity
            } else {
                return true;
            }
        });

        for (var i = 0; i < toRotate.length; i++) {
            var entityID = toRotate[i];
            var initialProperties = SelectionManager.savedProperties[entityID];

            var newProperties = {
                rotation: Quat.multiply(rotationChange, initialProperties.rotation)
            };

            if (reposition) {
                var dPos = Vec3.subtract(initialProperties.position, initialPosition);
                dPos = Vec3.multiplyQbyV(rotationChange, dPos);
                newProperties.position = Vec3.sum(initialPosition, dPos);
            }

            Entities.editEntity(entityID, newProperties);
        }
    }

    // TOOL DEFINITION: HANDLE ROTATION TOOL   
    function addHandleRotateTool(overlay, mode, direction) {
        var selectedHandle = null;
        var worldRotation = null;
        var initialRotation = null;
        var rotationCenter = null;
        var rotationNormal = null;
        var rotationZero = null;
        var rotationDegreesPosition = null;
        addHandleTool(overlay, {
            mode: mode,
            onBegin: function(event, pickRay, pickResult) {
                var wantDebug = false;
                if (wantDebug) {
                    print("================== " + getMode() + "(addHandleRotateTool onBegin) -> =======================");
                }
                
                if (direction === ROTATE_DIRECTION.PITCH) {
                    rotationNormal = { x: 1, y: 0, z: 0 };
                    worldRotation = worldRotationY;
                    selectedHandle = handleRotatePitchRing;
                } else if (direction === ROTATE_DIRECTION.YAW) {
                    rotationNormal = { x: 0, y: 1, z: 0 };
                    worldRotation = worldRotationZ;
                    selectedHandle = handleRotateYawRing;
                } else if (direction === ROTATE_DIRECTION.ROLL) {
                    rotationNormal = { x: 0, y: 0, z: 1 };
                    worldRotation = worldRotationX;
                    selectedHandle = handleRotateRollRing;
                }
                
                initialRotation = spaceMode === SPACE_LOCAL ? SelectionManager.localRotation : SelectionManager.worldRotation;
                rotationNormal = Vec3.multiplyQbyV(initialRotation, rotationNormal);
                rotationCenter = SelectionManager.worldPosition;

                SelectionManager.saveProperties();
                that.resetPreviousHandleColor();
    
                that.setHandleTranslateVisible(false);
                that.setHandleRotatePitchVisible(direction === ROTATE_DIRECTION.PITCH);
                that.setHandleRotateYawVisible(direction === ROTATE_DIRECTION.YAW);
                that.setHandleRotateRollVisible(direction === ROTATE_DIRECTION.ROLL);
                that.setHandleStretchVisible(false);
                that.setHandleScaleVisible(false);
                that.setHandleDuplicatorVisible(false);

                Overlays.editOverlay(selectedHandle, { 
                    hasTickMarks: true,
                    solid: false,
                    innerRadius: ROTATE_RING_SELECTED_INNER_RADIUS
                });

                Overlays.editOverlay(rotationDegreesDisplay, { visible: true });
                Overlays.editOverlay(handleRotateCurrentRing, {
                    position: rotationCenter,
                    rotation: worldRotation,
                    startAt: 0,
                    endAt: 0,
                    visible: true,
                    ignorePickIntersection: false
                });

                // editOverlays may not have committed rotation changes.
                // Compute zero position based on where the overlay will be eventually.
                var initialPick = rayPlaneIntersection(pickRay, rotationCenter, rotationNormal);
                // In case of a parallel ray, this will be null, which will cause early-out
                // in the onMove helper.
                rotationZero = initialPick;

                var rotationCenterToZero = Vec3.subtract(rotationZero, rotationCenter);
                var rotationCenterToZeroLength = Vec3.length(rotationCenterToZero);
                rotationDegreesPosition = Vec3.sum(rotationCenter, Vec3.multiply(Vec3.normalize(rotationCenterToZero), 
                                                   rotationCenterToZeroLength * ROTATE_DISPLAY_DISTANCE_MULTIPLIER));
                updateRotationDegreesOverlay(0, rotationDegreesPosition);
                
                if (debugPickPlaneEnabled) {
                    that.showDebugPickPlane(rotationCenter, rotationNormal);
                    that.showDebugPickPlaneHit(initialPick);
                }

                if (wantDebug) {
                    print("================== " + getMode() + "(addHandleRotateTool onBegin) <- =======================");
                }
            },
            onEnd: function(event, reason) {
                var wantDebug = false;
                if (wantDebug) {
                    print("================== " + getMode() + "(addHandleRotateTool onEnd) -> =======================");
                }
                Overlays.editOverlay(rotationDegreesDisplay, { visible: false, ignorePickIntersection: true });
                Overlays.editOverlay(selectedHandle, { 
                    hasTickMarks: false,
                    solid: true,
                    innerRadius: ROTATE_RING_IDLE_INNER_RADIUS
                });
                Overlays.editOverlay(handleRotateCurrentRing, { visible: false, ignorePickIntersection: true });
                pushCommandForSelections();
                if (wantDebug) {
                    print("================== " + getMode() + "(addHandleRotateTool onEnd) <- =======================");
                }
            },
            onMove: function(event) {
                if (!rotationZero) {
                    print("ERROR: entitySelectionTool.addHandleRotateTool.onMove - " +
                          "Invalid RotationZero Specified (missed rotation target plane?)");

                    // EARLY EXIT
                    return;
                }
                
                var wantDebug = false;
                if (wantDebug) {
                    print("================== "+ getMode() + "(addHandleRotateTool onMove) -> =======================");
                    Vec3.print("    rotationZero: ", rotationZero);
                }

                var pickRay = generalComputePickRay(event.x, event.y);
                var result = rayPlaneIntersection(pickRay, rotationCenter, rotationNormal);
                if (result) {
                    var centerToZero = Vec3.subtract(rotationZero, rotationCenter);
                    var centerToIntersect = Vec3.subtract(result, rotationCenter);

                    if (wantDebug) {
                        Vec3.print("    RotationNormal:    ", rotationNormal);
                        Vec3.print("    rotationZero:           ", rotationZero);
                        Vec3.print("    rotationCenter:         ", rotationCenter);
                        Vec3.print("    intersect:         ", result);
                        Vec3.print("    centerToZero:      ", centerToZero);
                        Vec3.print("    centerToIntersect: ", centerToIntersect);
                    }

                    // Note: orientedAngle which wants normalized centerToZero and centerToIntersect
                    //             handles that internally, so it's to pass unnormalized vectors here.
                    var angleFromZero = Vec3.orientedAngle(centerToZero, centerToIntersect, rotationNormal);        
                    var snapAngle = ctrlPressed ? ROTATE_CTRL_SNAP_ANGLE : ROTATE_DEFAULT_SNAP_ANGLE;
                    angleFromZero = Math.floor(angleFromZero / snapAngle) * snapAngle;
                    var rotationChange = Quat.angleAxis(angleFromZero, rotationNormal);
                    updateSelectionsRotation(rotationChange, rotationCenter);
                    updateRotationDegreesOverlay(-angleFromZero, rotationDegreesPosition);

                    if (direction === ROTATE_DIRECTION.YAW) {
                        angleFromZero *= -1;
                    }

                    var startAtCurrent = 0;
                    var endAtCurrent = angleFromZero;
                    var maxDegrees = 360;
                    if (angleFromZero < 0) {
                        startAtCurrent = maxDegrees + angleFromZero;
                        endAtCurrent = maxDegrees;
                    }
                    Overlays.editOverlay(handleRotateCurrentRing, {
                        startAt: startAtCurrent,
                        endAt: endAtCurrent
                    });
                    
                    if (debugPickPlaneEnabled) {
                        that.showDebugPickPlaneHit(result);
                    }
                }

                if (wantDebug) {
                    print("================== "+ getMode() + "(addHandleRotateTool onMove) <- =======================");
                }
            }
        });
    }    

    addHandleTranslateXZTool(selectionBox, "TRANSLATE_XZ", false);
    addHandleTranslateXZTool(iconSelectionBox, "TRANSLATE_XZ", false);
    addHandleTranslateXZTool(handleDuplicator, "DUPLICATE", true);

    addHandleTranslateTool(handleTranslateXCone, "TRANSLATE_X", TRANSLATE_DIRECTION.X);
    addHandleTranslateTool(handleTranslateXCylinder, "TRANSLATE_X", TRANSLATE_DIRECTION.X);
    addHandleTranslateTool(handleTranslateYCone, "TRANSLATE_Y", TRANSLATE_DIRECTION.Y);
    addHandleTranslateTool(handleTranslateYCylinder, "TRANSLATE_Y", TRANSLATE_DIRECTION.Y);
    addHandleTranslateTool(handleTranslateZCone, "TRANSLATE_Z", TRANSLATE_DIRECTION.Z);
    addHandleTranslateTool(handleTranslateZCylinder, "TRANSLATE_Z", TRANSLATE_DIRECTION.Z);

    addHandleRotateTool(handleRotatePitchRing, "ROTATE_PITCH", ROTATE_DIRECTION.PITCH);
    addHandleRotateTool(handleRotateYawRing, "ROTATE_YAW", ROTATE_DIRECTION.YAW);
    addHandleRotateTool(handleRotateRollRing, "ROTATE_ROLL", ROTATE_DIRECTION.ROLL);

    addHandleStretchTool(handleStretchXCube, "STRETCH_X", STRETCH_DIRECTION.X);
    addHandleStretchTool(handleStretchYCube, "STRETCH_Y", STRETCH_DIRECTION.Y);
    addHandleStretchTool(handleStretchZCube, "STRETCH_Z", STRETCH_DIRECTION.Z);

    addHandleScaleTool(handleScaleCube, "SCALE");
    
    return that;
}());
