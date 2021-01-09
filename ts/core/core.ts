import {jsPlumbDefaults, jsPlumbHelperFunctions} from "./defaults"

import {Connection} from "./connector/connection-impl"
import {Endpoint} from "./endpoint/endpoint-impl"
import {FullOverlaySpec, OverlayId, OverlaySpec} from "./overlay/overlay"
import {AnchorManager, AnchorPlacement, RedrawResult} from "./anchor-manager"
import {
    _mergeOverrides,
    addToList,
    findWithFunction,
    functionChain,
    IS,
    isString,
    log,
    removeWithFunction, rotateAnchorOrientation, rotatePoint,
    uuid,
    extend,
    filterList
} from "./util"

import {
    Dictionary,
    UpdateOffsetOptions,
    Offset,
    Size,
    jsPlumbElement,
    PointArray,
    ConnectParams,  // <--
    SourceDefinition,
    TargetDefinition,
    SourceOrTargetDefinition,
    BehaviouralTypeDescriptor,  // <--
    InternalConnectParams,
    TypeDescriptor
} from './common'

import { EventGenerator } from "./event-generator"
import * as Constants from "./constants"
import {AnchorSpec, makeAnchorFromSpec} from "./factory/anchor-factory"
import { Anchor } from "./anchor/anchor"
import {EndpointOptions} from "./endpoint/endpoint"
import {AddGroupOptions, GroupManager} from "./group/group-manager"
import {UIGroup} from "./group/group"
import {jsPlumbGeometry, jsPlumbGeometryHelpers} from "./geom"

import {DefaultRouter} from "./router/default-router"
import {Router} from "./router/router"
import {EndpointSelection} from "./selection/endpoint-selection"
import {ConnectionSelection} from "./selection/connection-selection"
import {Viewport, ViewportElement} from "./viewport"

import { Component, RepaintOptions } from '../core/component/component'
import { Segment } from '../core/connector/abstract-segment'
import { Overlay } from '../core/overlay/overlay'
import { LabelOverlay } from '../core/overlay/label-overlay'
import { AbstractConnector } from '../core/connector/abstract-connector'
import { OverlayCapableComponent } from '../core/component/overlay-capable-component'
import { PaintStyle} from '../core/styles'

function _scopeMatch(e1:Endpoint, e2:Endpoint):boolean {
    let s1 = e1.scope.split(/\s/), s2 = e2.scope.split(/\s/)
    for (let i = 0; i < s1.length; i++) {
        for (let j = 0; j < s2.length; j++) {
            if (s2[j] === s1[i]) {
                return true
            }
        }
    }

    return false
}

export interface AbstractSelectOptions {
    scope?:string
    source?:string | any | Array<string | any>
    target?:string | any | Array<string | any>
}
export interface SelectOptions extends AbstractSelectOptions {
    connections?:Array<Connection>
}

export interface SelectEndpointOptions extends AbstractSelectOptions {
    element?:string | any | Array<string | any>
}

/**
 * Optional parameters to the `DeleteConnection` method.
 */
export type DeleteConnectionOptions = {
    /**
     * if true, force deletion even if the connection tries to cancel the deletion.
     */
    force?:boolean
    /**
     * If false, an event won't be fired. Otherwise a `connectionDetached` event will be fired.
     */
    fireEvent?:boolean
    /**
     * Optional original event that resulted in the connection being deleted.
     */
    originalEvent?:Event

    /**
     * internally when a connection is deleted, it may be because the endpoint it was on is being deleted.
     * in that case we want to ignore that endpoint.
     */
    endpointToIgnore?:Endpoint
}

function prepareList(instance:JsPlumbInstance, input:any, doNotGetIds?:boolean):any {
    let r = []
    if (input) {
        if (typeof input === 'string') {
            if (input === "*") {
                return input
            }
            r.push(input)
        }
        else {
            if (doNotGetIds) {
                r = input
            }
            else {
                if (input.length != null) {
                    for (let i = 0, j = input.length; i < j; i++) {
                        r.push(instance.info(input[i]).id)
                    }
                }
                else {
                    r.push(instance.info(input).id)
                }
            }
        }
    }
    return r
}

export type ManagedElement = {
    el:jsPlumbElement,
    info?:ViewportElement,
    endpoints?:Array<Endpoint>,
    connections?:Array<Connection>,
    rotation?:number
}

export abstract class JsPlumbInstance extends EventGenerator {

    Defaults:jsPlumbDefaults
    private _initialDefaults:jsPlumbDefaults = {}

    isConnectionBeingDragged:boolean = false
    currentlyDragging:boolean = false
    hoverSuspended:boolean = false
    _suspendDrawing:boolean = false
    _suspendedAt:string = null

    connectorClass = "jtk-connector"
    connectorOutlineClass = "jtk-connector-outline"
    connectedClass = "jtk-connected"
    endpointClass = "jtk-endpoint"
    endpointConnectedClass = "jtk-endpoint-connected"
    endpointFullClass = "jtk-endpoint-full"
    endpointDropAllowedClass = "jtk-endpoint-drop-allowed"
    endpointDropForbiddenClass = "jtk-endpoint-drop-forbidden"
    endpointAnchorClassPrefix = "jtk-endpoint-anchor"
    overlayClass = "jtk-overlay"

    connections:Array<Connection> = []
    endpointsByElement:Dictionary<Array<Endpoint>> = {}
    endpointsByUUID:Dictionary<Endpoint> = {}

    public allowNestedGroups:boolean

    private _curIdStamp :number = 1
    private _offsetTimestamps:Dictionary<string> = {}
    readonly viewport:Viewport = new Viewport()

    router: Router
    anchorManager:AnchorManager
    groupManager:GroupManager
    private _connectionTypes:Dictionary<TypeDescriptor> = {}
    private _endpointTypes:Dictionary<TypeDescriptor> = {}
    private _container:any

    protected _managedElements:Dictionary<ManagedElement> = {}
    private _floatingConnections:Dictionary<Connection> = {}

    DEFAULT_SCOPE:string

    private _helpers:jsPlumbHelperFunctions
    public geometry:jsPlumbGeometryHelpers

    private _zoom:number = 1

    constructor(public readonly _instanceIndex:number, defaults?:jsPlumbDefaults, helpers?:jsPlumbHelperFunctions) {

        super()

        this._helpers = helpers || {}

        this.geometry = new jsPlumbGeometry()

        this.Defaults = {
            anchor: "Bottom",
            anchors: [ null, null ],
            connectionsDetachable: true,
            connectionOverlays: [ ],
            connector: "Bezier",
            container: null,
            endpoint: "Dot",
            endpointOverlays: [ ],
            endpoints: [ null, null ],
            endpointStyle: { fill: "#456" },
            endpointStyles: [ null, null ],
            endpointHoverStyle: null,
            endpointHoverStyles: [ null, null ],
            hoverPaintStyle: null,
            listStyle: { },
            maxConnections: 1,
            paintStyle: { strokeWidth: 2, stroke: "#456" },
            reattachConnections: false,
            scope: "jsplumb_defaultscope",
            allowNestedGroups:true
        }

        if (defaults) {
            extend(this.Defaults, defaults)
        }

        extend(this._initialDefaults, this.Defaults)
        this.DEFAULT_SCOPE = this.Defaults.scope

        this.allowNestedGroups = this._initialDefaults.allowNestedGroups !== false

        this.router = new DefaultRouter(this)

        // TODO we don't want to expose the anchor manager on the instance. we dont want to expose it on Router, either.
        // this cast would currently mean any alternative Router could fail (if it didn't expose an anchorManager).
        // this is something that will need to be refactored before the Toolkit edition 4.x can be released.
        this.anchorManager = (this.router as DefaultRouter).anchorManager
        this.groupManager = new GroupManager(this)

        this.setContainer(this._initialDefaults.container)
    }

    getSize(el:any) {
        return this._helpers.getSize ? this._helpers.getSize(el) : this._getSize(el)
    }

    getOffset(el:any|string, relativeToRoot?:boolean):Offset {
        if (relativeToRoot) {
            return this._helpers.getOffsetRelativeToRoot ? this._helpers.getOffsetRelativeToRoot(el) : this._getOffsetRelativeToRoot(el)
        } else {
            return this._helpers.getOffset ? this._helpers.getOffset(el) : this._getOffset(el)
        }
    }

    getContainer():any { return this._container; }

    setZoom (z:number, repaintEverything?:boolean):boolean {
        this._zoom = z
        this.fire(Constants.EVENT_ZOOM, this._zoom)
        if (repaintEverything) {
            this.repaintEverything()
        }
        return true
    }

    getZoom ():number {
        return this._zoom
    }

    info (el:string | any):{el:jsPlumbElement, text?:boolean, id?:string} {
        if (el == null) {
            return null
        }
        // this is DOM specific, we dont want this in this class.
        else if ((<any>el).nodeType === 3 || (<any>el).nodeType === 8) {
            return { el:el, text:true }
        }
        else {
            let _el = this.getElement(el)
            return { el: _el, id: (isString(el) && _el == null) ? el as string : this.getId(_el) }
        }
    }

    _idstamp ():string {
        return "" + this._curIdStamp++
    }

    convertToFullOverlaySpec(spec:string | OverlaySpec):FullOverlaySpec {
        let o:FullOverlaySpec = null
        if (isString(spec)) {
            o = [ spec as OverlayId, { } ]
        } else {
            o = spec as FullOverlaySpec
        }
        o[1].id = o[1].id || uuid()
        return o
    }

    checkCondition(conditionName:string, args?:any):boolean {
        let l = this.getListener(conditionName),
            r = true

        if (l && l.length > 0) {
            let values = Array.prototype.slice.call(arguments, 1)
            try {
                for (let i = 0, j = l.length; i < j; i++) {
                    r = r && l[i].apply(l[i], values)
                }
            }
            catch (e) {
                log("cannot check condition [" + conditionName + "]" + e)
            }
        }
        return r
    }

    getId (element:jsPlumbElement, uuid?:string):string {
        // if (isString(element)) {
        //     return element as string
        // }
        if (element == null) {
            return null
        }

        let id:string = this.getAttribute(element, "id")
        if (!id || id === "undefined") {
            // check if fixed uuid parameter is given
            if (arguments.length === 2 && arguments[1] !== undefined) {
                id = uuid
            }
            else if (arguments.length === 1 || (arguments.length === 3 && !arguments[2])) {
                id = "jsplumb-" + this._instanceIndex + "-" + this._idstamp()
            }

            this.setAttribute(element, "id", id)
        }
        return id
    }

    /**
     * Set the id of the given element. Changes all the refs etc.  TODO: this method should not be necessary, at least not as
     * part of the public API for the community edition, when we no longer key anything off each element's DOM id.
     * The Toolkit edition may still need to advise the Community edition an id was changed, in some circumstances - needs verification.
     * @param el
     * @param newId
     * @param doNotSetAttribute
     */
    setId (el:any, newId:string, doNotSetAttribute?:boolean):void {
        //
        let id:string, _el:any

        if (isString(el)) {
            id = el as string
        }
        else {
            _el = this.getElement(el)
            id = this.getId(_el)
        }

        let sConns = this.getConnections({source: id, scope: '*'}, true) as Array<Connection>,
            tConns = this.getConnections({target: id, scope: '*'}, true) as Array<Connection>

        newId = "" + newId

        if (!doNotSetAttribute) {
            _el = this.getElement(id)
            this.setAttribute(_el, "id", newId)
        }
        else {
            _el = this.getElement(newId)
        }

        this.endpointsByElement[newId] = this.endpointsByElement[id] || []
        for (let i = 0, ii = this.endpointsByElement[newId].length; i < ii; i++) {
            this.endpointsByElement[newId][i].setElementId(newId)
            this.endpointsByElement[newId][i].setReferenceElement(_el)
        }
        delete this.endpointsByElement[id]
        this._managedElements[newId] = this._managedElements[id]
        delete this._managedElements[id]

        const _conns = (list:Array<Connection>, epIdx:number, type:string) => {
            for (let i = 0, ii = list.length; i < ii; i++) {
                list[i].endpoints[epIdx].setElementId(newId)
                list[i].endpoints[epIdx].setReferenceElement(_el)
                list[i][type + "Id"] = newId
                list[i][type] = _el
            }
        }
        _conns(sConns, 0, Constants.SOURCE)
        _conns(tConns, 1, Constants.TARGET)

        this.repaint(_el)
    }

    setIdChanged(oldId:string, newId:string) {
        this.setId(oldId, newId, true)
    }

    getCachedData(elId:string):ViewportElement {

        let o = this.viewport.getPosition(elId)
        if (!o) {
            return this.updateOffset({elId: elId})
        }
        else {
            return o
        }
    }


// ------------------  element selection ------------------------

    getConnections(options?:SelectOptions, flat?:boolean):Dictionary<Connection> | Array<Connection> {
        if (!options) {
            options = {}
        } else if (options.constructor === String) {
            options = { "scope": options } as SelectOptions
        }
        let scope = options.scope || this.getDefaultScope(),
            scopes = prepareList(this, scope, true),
            sources = prepareList(this, options.source),
            targets = prepareList(this, options.target),
            results = (!flat && scopes.length > 1) ? {} : [],
            _addOne = (scope:string, obj:any) => {
                if (!flat && scopes.length > 1) {
                    let ss = results[scope]
                    if (ss == null) {
                        ss = results[scope] = []
                    }
                    ss.push(obj)
                } else {
                    (<Array<any>>results).push(obj)
                }
            }

        for (let j = 0, jj = this.connections.length; j < jj; j++) {
            let c = this.connections[j],
                sourceId = c.proxies && c.proxies[0] ? c.proxies[0].originalEp.elementId : c.sourceId,
                targetId = c.proxies && c.proxies[1] ? c.proxies[1].originalEp.elementId : c.targetId

            if (filterList(scopes, c.scope) && filterList(sources, sourceId) && filterList(targets, targetId)) {
                _addOne(c.scope, c)
            }
        }

        return results
    }

    select (params?:SelectOptions):ConnectionSelection {
        params = params || {}
        params.scope = params.scope || "*"
        return new ConnectionSelection(this, params.connections || (this.getConnections(params, true) as Array<Connection>))
    }

    selectEndpoints(params?:SelectEndpointOptions):EndpointSelection {
        params = params || {}
        params.scope = params.scope || "*"

        let noElementFilters = !params.element && !params.source && !params.target,
            elements = noElementFilters ? "*" : prepareList(this, params.element),
            sources = noElementFilters ? "*" : prepareList(this, params.source),
            targets = noElementFilters ? "*" : prepareList(this, params.target),
            scopes = prepareList(this, params.scope, true)

        let ep:Array<Endpoint> = []

        for (let el in this.endpointsByElement) {
            let either = filterList(elements, el, true),
                source = filterList(sources, el, true),
                sourceMatchExact = sources !== "*",
                target = filterList(targets, el, true),
                targetMatchExact = targets !== "*"

            // if they requested 'either' then just match scope. otherwise if they requested 'source' (not as a wildcard) then we have to match only endpoints that have isSource set to to true, and the same thing with isTarget.
            if (either || source || target) {
                inner:
                    for (let i = 0, ii = this.endpointsByElement[el].length; i < ii; i++) {
                        let _ep = this.endpointsByElement[el][i]
                        if (filterList(scopes, _ep.scope, true)) {

                            let noMatchSource = (sourceMatchExact && sources.length > 0 && !_ep.isSource),
                                noMatchTarget = (targetMatchExact && targets.length > 0 && !_ep.isTarget)

                            if (noMatchSource || noMatchTarget) {
                                continue inner
                            }

                            ep.push(_ep)
                        }
                    }
            }
        }

        return new EndpointSelection(this, ep)
    }

    setContainer(c:string | jsPlumbElement):void {
        // get container as element and set container.
        this._container = this.getElement(c)
        // tell people.
        this.fire(Constants.EVENT_CONTAINER_CHANGE, this._container)
    }

    private _set (c:Connection, el:any|Endpoint, idx:number, doNotRepaint?:boolean):any {

        const stTypes = [
            { el: "source", elId: "sourceId", epDefs: Constants.SOURCE_DEFINITION_LIST },
            { el: "target", elId: "targetId", epDefs: Constants.TARGET_DEFINITION_LIST }
        ]

        let ep, _st = stTypes[idx], cId = c[_st.elId], /*cEl = c[_st.el],*/ sid, sep,
            oldEndpoint = c.endpoints[idx]

        let evtParams = {
            index: idx,
            originalSourceId: idx === 0 ? cId : c.sourceId,
            newSourceId: c.sourceId,
            originalTargetId: idx === 1 ? cId : c.targetId,
            newTargetId: c.targetId,
            connection: c
        }

        if (el instanceof Endpoint) {
            ep = el;
            (<Endpoint>ep).addConnection(c)
            el = (<Endpoint>ep).element
        }
        else {
            sid = this.getId(el)
            sep = el[_st.epDefs] ? el[_st.epDefs][0] : null

            if (sid === c[_st.elId]) {
                ep = null; // dont change source/target if the element is already the one given.
            }
            else if (sep) {

                if (!sep.enabled) {
                    return
                }
                ep = sep.endpoint != null ? sep.endpoint : this.addEndpoint(el, sep.def)
                if (sep.uniqueEndpoint) {
                    sep.endpoint = ep
                }
                ep.addConnection(c)
            }
            else {
                ep = c.makeEndpoint(idx === 0, el, sid)
            }
        }

        if (ep != null) {
            oldEndpoint.detachFromConnection(c)
            c.endpoints[idx] = ep
            c[_st.el] = ep.element
            c[_st.elId] = ep.elementId
            evtParams[idx === 0 ? "newSourceId" : "newTargetId"] = ep.elementId

            this.fireMoveEvent(evtParams)

            if (!doNotRepaint) {
                c.paint()
            }
        }

        (<any>evtParams).element = el
        return evtParams

    }

    setSource (connection:Connection, el:any|Endpoint, doNotRepaint?:boolean):void {
        let p = this._set(connection, el, 0, doNotRepaint)
        this.sourceOrTargetChanged(p.originalSourceId, p.newSourceId, connection, p.el, 0)
    }

    setTarget (connection:Connection, el:any|Endpoint, doNotRepaint?:boolean):void {
        let p = this._set(connection, el, 1, doNotRepaint)
        connection.updateConnectedClass()
    }

    /**
     * Returns whether or not hover is currently suspended.
     */
    isHoverSuspended():boolean { return this.hoverSuspended; }

    /**
     * Sets whether or not drawing is suspended.
     * @param val True to suspend, false to enable.
     * @param repaintAfterwards If true, repaint everything afterwards.
     */
    setSuspendDrawing (val?:boolean, repaintAfterwards?:boolean):boolean {
        let curVal = this._suspendDrawing
        this._suspendDrawing = val
        if (val) {
            this._suspendedAt = "" + new Date().getTime()
        } else {
            this._suspendedAt = null
        }
        if (repaintAfterwards) {
            this.repaintEverything()
        }
        return curVal
    }

    computeAnchorLoc(endpoint:Endpoint, timestamp?:string):AnchorPlacement {

        const myOffset = this._managedElements[endpoint.elementId].info
        const anchorLoc = endpoint.anchor.compute({
            xy: [ myOffset.x, myOffset.y ],
            wh : [myOffset.w, myOffset.h],
            element: endpoint,
            timestamp: timestamp || this._suspendedAt,
            rotation:this._managedElements[endpoint.elementId].rotation
        })
        return anchorLoc

    }

    // return time for when drawing was suspended.
    getSuspendedAt ():string {
        return this._suspendedAt
    }

    /**
     * Suspend drawing, run the given function, and then re-enable drawing, optionally repainting everything.
     * @param fn Function to run while drawing is suspended.
     * @param doNotRepaintAfterwards Whether or not to repaint everything after drawing is re-enabled.
     */
    batch (fn:Function, doNotRepaintAfterwards?:boolean):void {
        const _wasSuspended = this._suspendDrawing === true
        if (!_wasSuspended) {
            this.setSuspendDrawing(true)
        }
        fn()
        if (!_wasSuspended) {
            this.setSuspendDrawing(false, !doNotRepaintAfterwards)
        }
    }

    getDefaultScope ():string {
        return this.DEFAULT_SCOPE
    }

    /**
     * Execute the given function for each of the given elements.
     * @param spec An Element, or an element id, or an array of elements/element ids.
     * @param fn The function to run on each element.
     */
    each(spec:jsPlumbElement | Array<jsPlumbElement>, fn:(e:jsPlumbElement) => any):JsPlumbInstance {
        if (spec == null) {
            return
        }
        if ((<any>spec).length != null) {
            for (let i = 0; i < (<Array<any>>spec).length; i++) {
                fn(spec[i])
            }
        }
        else {
            fn(spec as jsPlumbElement)
        } // assume it's an element.

        return this
    }

    /**
     * Update the cached offset information for some element.
     * @param params
     * @return an UpdateOffsetResult containing the offset information for the given element.
     */
    updateOffset(params?:UpdateOffsetOptions):ViewportElement {

        let timestamp = params.timestamp,
            recalc = params.recalc,
            offset = params.offset,
            elId = params.elId,
            s

        if (this._suspendDrawing && !timestamp) {
            timestamp = this._suspendedAt
        }
        if (!recalc) {
            if (timestamp && timestamp === this._offsetTimestamps[elId]) {
                return this.viewport.getPosition(elId)
            }
        }
        if (recalc || (!offset && this.viewport.getPosition(elId) == null)) { // if forced repaint or no offset available, we recalculate.

            // get the current size and offset, and store them
            s = this._managedElements[elId] ? this._managedElements[elId].el : null
            if (s != null) {

                const size = this.getSize(s)
                const offset = this.getOffset(s)

                this.viewport.updateElement(elId, offset.left, offset.top, size[0], size[1], null)
                this._offsetTimestamps[elId] = timestamp
            }
        } else {
            // if offset available, update the viewport
            if (offset != null) {
                this.viewport.setPosition(elId, offset.left, offset.top)
            }
            this._offsetTimestamps[elId] = timestamp
        }

        return this.viewport.getPosition(elId)
    }

    /**
     * Delete the given connection.
     * @param connection Connection to delete.
     * @param params Optional extra parameters.
     */
    deleteConnection (connection:Connection, params?:DeleteConnectionOptions):boolean {

        if (connection != null) {
            params = params || {}

            if (params.force || functionChain(true, false, [
                    [ connection.endpoints[0], Constants.IS_DETACH_ALLOWED, [ connection ] ],
                    [ connection.endpoints[1], Constants.IS_DETACH_ALLOWED, [ connection ] ],
                    [ connection, Constants.IS_DETACH_ALLOWED, [ connection ] ],
                    [ this, Constants.CHECK_CONDITION, [ Constants.BEFORE_DETACH, connection ] ]
                ])) {

                this.fireDetachEvent(connection, !connection.pending && params.fireEvent !== false, params.originalEvent)

                const sourceEndpoint = connection.endpoints[0]
                const targetEndpoint = connection.endpoints[1]

                if (sourceEndpoint !== params.endpointToIgnore) {
                    sourceEndpoint.detachFromConnection(connection, null, true)
                }

                if (targetEndpoint !== params.endpointToIgnore) {
                    targetEndpoint.detachFromConnection(connection, null, true)
                }

                removeWithFunction(this.connections, (_c:Connection) => {
                    return connection.id === _c.id
                })

                connection.destroy()

                if (sourceEndpoint !== params.endpointToIgnore && sourceEndpoint.deleteOnEmpty && sourceEndpoint.connections.length === 0) {
                    this.deleteEndpoint(sourceEndpoint)
                }

                if (targetEndpoint !== params.endpointToIgnore && targetEndpoint.deleteOnEmpty && targetEndpoint.connections.length === 0) {
                    this.deleteEndpoint(targetEndpoint)
                }

                return true
            }
        }
        return false
    }

    deleteEveryConnection (params?:DeleteConnectionOptions):number {
        params = params || {}
        let count = this.connections.length, deletedCount = 0
        this.batch(() => {
            for (let i = 0; i < count; i++) {
                deletedCount += this.deleteConnection(this.connections[0], params) ? 1 : 0
            }
        })
        return deletedCount
    }

    deleteConnectionsForElement(el:jsPlumbElement, params?:DeleteConnectionOptions):JsPlumbInstance {
        params = params || {}
        let id = this.getId(el), endpoints = this.endpointsByElement[id]
        if (endpoints && endpoints.length) {
            for (let i = 0, j = endpoints.length; i < j; i++) {
                endpoints[i].deleteEveryConnection(params)
            }
        }
        return this
    }

    private fireDetachEvent (jpc:Connection | any, doFireEvent?:boolean, originalEvent?:Event):void {
        // may have been given a connection, or in special cases, an object
        let argIsConnection:boolean = (jpc.id != null),
            params = argIsConnection ? {
                connection: jpc,
                source: jpc.source, target: jpc.target,
                sourceId: jpc.sourceId, targetId: jpc.targetId,
                sourceEndpoint: jpc.endpoints[0], targetEndpoint: jpc.endpoints[1]
            } : jpc

        if (doFireEvent) {
            this.fire(Constants.EVENT_CONNECTION_DETACHED, params, originalEvent)
        }

        // always fire this. used by internal jsplumb stuff.
        this.fire(Constants.EVENT_INTERNAL_CONNECTION_DETACHED, params, originalEvent)

        this.router.connectionDetached(params.connection)
    }

    fireMoveEvent (params?:any, evt?:Event):void {
        this.fire(Constants.EVENT_CONNECTION_MOVED, params, evt)
    }

    /**
     * Manage a group of elements.
     * @param elements Array-like object of strings or DOM elements.
     * @param recalc Maybe recalculate offsets for the element also.
     */
    manageAll (elements:Array<jsPlumbElement>, recalc?:boolean):void {
        for (let i = 0; i < elements.length; i++) {
            this.manage(elements[i], null, recalc)
        }
    }

    /**
     * Manage an element.
     * @param element String, or DOM element.
     * @param recalc Maybe recalculate offsets for the element also.
     */
    manage (element:jsPlumbElement, internalId?:string, recalc?:boolean):ManagedElement {

        if (this.getAttribute(element, "jsplumb-id") == null) {
            internalId = internalId || uuid()
            this.setAttribute(element, "jsplumb-id", internalId)
        }

        const elId = this.getId(element)

        if (!this._managedElements[elId]) {

            this.setAttribute(element, Constants.ATTRIBUTE_MANAGED, "")

            this._managedElements[elId] = {
                el:element,
                endpoints:[],
                connections:[],
                rotation:0
            }

            if (this._suspendDrawing) {
                this._managedElements[elId].info = this.viewport.registerElement(elId)

            } else {
                this._managedElements[elId].info = this.updateOffset({elId: elId, recalc:true})
            }

        } else {
            if (recalc) {
                this._managedElements[elId].info = this.updateOffset({elId: elId, timestamp: null,  recalc:true })
            }
        }

        return this._managedElements[elId]
    }

    /**
     * Stops managing the given element.
     * @param el Element, or ID of the element to stop managing.
     */
    unmanage (el:jsPlumbElement, removeElement?:boolean):void {

        let affectedElements:Array<jsPlumbElement> = []

        this.removeAllEndpoints(el, true, affectedElements)

        let _one = (_el:jsPlumbElement) => {

            let id = this.getId(_el)

            this.anchorManager.clearFor(id)
            this.anchorManager.removeFloatingConnection(id)

            if (this.isSource(_el)) {
                this.unmakeSource(_el)
            }
            if (this.isTarget(_el)) {
                this.unmakeTarget(_el)
            }

            delete this._floatingConnections[id]

            this.removeAttribute(_el, Constants.ATTRIBUTE_MANAGED)
            delete this._managedElements[id]

            this.viewport.remove(id)

            if (_el && removeElement) {
                this.removeElement(_el)
            }
        }

        // remove all affected child elements
        for (let ae = 1; ae < affectedElements.length; ae++) {
            _one(affectedElements[ae])
        }

        // and always remove the requested one from the dom.
        _one(el)
    }

    rotate(elementId:string, rotation:number, doNotRepaint?:boolean):RedrawResult {
        if (this._managedElements[elementId]) {
            this._managedElements[elementId].rotation = rotation
            this.viewport.rotateElement(elementId, rotation)
            if (doNotRepaint !== true) {
                return this.revalidate(this._managedElements[elementId].el)
            }
        }

        return { c:new Set(), e:new Set() }
    }

    getRotation(elementId:string):number {
        return this._managedElements[elementId] ? (this._managedElements[elementId].rotation || 0) : 0
    }

    newEndpoint(params:EndpointOptions, id?:string):Endpoint {
        let _p = extend({}, params)
        _p.elementId = id || this.getId(_p.source)

        let ep = new Endpoint(this, _p)
        ep.id = "ep_" + this._idstamp()
        this.manage(_p.source)

        return ep
    }

    deriveEndpointAndAnchorSpec(type:string, dontPrependDefault?:boolean):any {
        let bits = ((dontPrependDefault ? "" : "default ") + type).split(/[\s]/), eps = null, ep = null, a = null, as = null
        for (let i = 0; i < bits.length; i++) {
            let _t = this.getType(bits[i], "connection")
            if (_t) {
                if (_t.endpoints) {
                    eps = _t.endpoints
                }
                if (_t.endpoint) {
                    ep = _t.endpoint
                }
                if (_t.anchors) {
                    as = _t.anchors
                }
                if (_t.anchor) {
                    a = _t.anchor
                }
            }
        }
        return { endpoints: eps ? eps : [ ep, ep ], anchors: as ? as : [a, a ]}
    }

    getAllConnections ():Array<Connection> {
        return this.connections
    }

    // repaint some element's endpoints and connections
    repaint (el:string | any, ui?:any, timestamp?:string):RedrawResult {
        return this._draw(el, ui, timestamp)
    }

    revalidate (el:jsPlumbElement, timestamp?:string):RedrawResult {
        let elId = this.getId(el)
        this.updateOffset({ elId: elId, recalc: true, timestamp:timestamp })
        return this.repaint(el)
    }

    // repaint every endpoint and connection.
    repaintEverything ():JsPlumbInstance {
        let timestamp = uuid(), elId:string

        for (elId in this.endpointsByElement) {
            this.updateOffset({ elId: elId, recalc: true, timestamp: timestamp })
        }

        for (elId in this.endpointsByElement) {
            this._draw(elId, null, timestamp, true)
        }

        return this
    }

    /**
     * for some given element, find any other elements we want to draw whenever that element
     * is being drawn. for groups, for example, this means any child elements of the group.
     * @param el
     * @private
     */
    abstract _getAssociatedElements(el:any):Array<any>

    _draw(element:string | any, ui?:any, timestamp?:string, offsetsWereJustCalculated?:boolean):RedrawResult {

        let r:RedrawResult = {
            c:new Set<Connection>(),
            e:new Set<Endpoint>()
        }

        const _mergeRedraw = (r2:RedrawResult) => {
            // merge in r2 to r
            r2.c.forEach((c) => r.c.add(c))
            r2.e.forEach((e) => r.e.add(e))
        }

        if (!this._suspendDrawing) {

            let id = typeof element === "string" ? element as string : this.getId(element),
                el = typeof element === "string" ? this.getElementById(element as string) : element

            if (el != null) {
                let repaintEls = this._getAssociatedElements(el),
                    repaintOffsets:Array<ViewportElement> = []

                if (timestamp == null) {
                    timestamp = uuid()
                }

                if (!offsetsWereJustCalculated) {
                    // update the offset of everything _before_ we try to draw anything.
                    this.updateOffset({elId: id, offset: ui, recalc: false, timestamp: timestamp})
                    for (let i = 0; i < repaintEls.length; i++) {
                        repaintOffsets.push(this.updateOffset({
                            elId: this.getId(repaintEls[i]),
                            recalc: true,
                            timestamp: timestamp
                        }))
                    }
                } else {
                    for (let i = 0; i < repaintEls.length; i++) {
                        const reId = this.getId(repaintEls[i])
                        repaintOffsets.push(this.viewport.getPosition(reId))
                    }
                }

                _mergeRedraw(this.router.redraw(id, ui, timestamp, null))

                if (repaintEls.length > 0) {
                    for (let j = 0; j < repaintEls.length; j++) {
                        _mergeRedraw(this.router.redraw(this.getId(repaintEls[j]), repaintOffsets[j], timestamp, null))
                    }
                }
            }
        }

        return r
    }

    unregisterEndpoint(endpoint:Endpoint) {
        const uuid = endpoint.getUuid()
        if (uuid) {
            delete this.endpointsByUUID[uuid]
        }
        this.router.deleteEndpoint(endpoint)

        // TODO at least replace this with a removeWithFunction call.
        for (let e in this.endpointsByElement) {
            let endpoints = this.endpointsByElement[e]
            if (endpoints) {
                let newEndpoints = []
                for (let i = 0, j = endpoints.length; i < j; i++) {
                    if (endpoints[i] !== endpoint) {
                        newEndpoints.push(endpoints[i])
                    }
                }

                this.endpointsByElement[e] = newEndpoints
            }
            if (this.endpointsByElement[e].length < 1) {
                delete this.endpointsByElement[e]
            }
        }
    }

    maybePruneEndpoint(endpoint:Endpoint):boolean {
        if (endpoint.deleteOnEmpty && endpoint.connections.length === 0) {
            this.deleteEndpoint(endpoint)
            return true
        } else {
            return false
        }
    }

    deleteEndpoint(object:string | Endpoint):JsPlumbInstance {
        let endpoint = (typeof object === "string") ? this.endpointsByUUID[object as string] : object as Endpoint
        if (endpoint) {

            // find all connections for the endpoint
            const connectionsToDelete = endpoint.connections.slice()
            connectionsToDelete.forEach((connection) => {
                // detach this endpoint from each of these connections.
                endpoint.detachFromConnection(connection, null, true)
            })

            // delete the endpoint
            this.unregisterEndpoint(endpoint)
            endpoint.destroy(true)

            // then delete the connections. each of these connections only has one endpoint at the moment
            connectionsToDelete.forEach((connection) => {
                // detach this endpoint from each of these connections.
                this.deleteConnection(connection, {force:true, endpointToIgnore:endpoint})
            })
        }
        return this
    }

    addEndpoint(el:jsPlumbElement, params?:EndpointOptions, referenceParams?:EndpointOptions):Endpoint{
        referenceParams = referenceParams || {} as EndpointOptions
        let p:EndpointOptions = extend({}, referenceParams)
        extend(p, params)
        p.endpoint = p.endpoint || this.Defaults.endpoint
        p.paintStyle = p.paintStyle || this.Defaults.endpointStyle
        let _p:EndpointOptions = extend({source:el}, p)
        let id = this.getId(_p.source)
        const mel:ManagedElement = this.manage(el, null, !this._suspendDrawing)
        let e = this.newEndpoint(_p, id)

        addToList(this.endpointsByElement, id, e)

        if (!this._suspendDrawing) {

            // why not just a full renderer.paintEndpoint method here?

            //this.renderer.paintEndpoint()  // but why does this method expect a paintStyle?

            const anchorLoc = this.computeAnchorLoc(e)
            e.paint({
                anchorLoc: anchorLoc,
                timestamp: this._suspendedAt
            })
        }

        return e
    }

    addEndpoints(el:jsPlumbElement, endpoints:Array<EndpointOptions>, referenceParams?:any):Array<Endpoint> {
        let results:Array<Endpoint> = []
        for (let i = 0, j = endpoints.length; i < j; i++) {
            results.push(this.addEndpoint(el, endpoints[i], referenceParams))
        }
        return results
    }

    // clears all endpoints and connections from the instance of jsplumb, optionally without firing any events
    // subclasses should take care of cleaning up the rendering.
    reset (silently?:boolean):void {
        this.silently(() => {
            this.endpointsByElement = {}
            this._managedElements = {}
            this.endpointsByUUID = {}
            this.viewport.reset()
            this._offsetTimestamps = {}
            this.router.reset()
            this.groupManager.reset()
            this._connectionTypes = {}
            this._endpointTypes = {}
            this.connections.length = 0
        })
    }

// ------ these are exposed for library packages to use; it allows them to be built without needing to include the utils --------
    uuid(): string {
        return uuid()
    }

    rotatePoint(point:Array<number>, center:PointArray, rotation:number):[number, number, number, number] {
        return rotatePoint(point, center, rotation)
    }

    rotateAnchorOrientation(orientation:[number, number], rotation:any):[number, number] {
        return rotateAnchorOrientation(orientation, rotation)
    }

// ---------------------------------------------------------------------------------

    // clears the instance (without firing any events) and unbinds any listeners on the instance.
    destroy():void {
        this.reset(true)
        this.unbind()
    }

    getEndpoints(el:jsPlumbElement):Array<Endpoint> {
        return this.endpointsByElement[this.getId(el)] || []
    }

    getEndpoint(id:string):Endpoint {
        return this.endpointsByUUID[id]
    }

    connect (params:ConnectParams, referenceParams?:ConnectParams):Connection {

        // prepare a final set of parameters to create connection with

        let _p = this._prepareConnectionParams(params, referenceParams), jpc:Connection
        // TODO probably a nicer return value if the connection was not made.  _prepareConnectionParams
        // will return null (and log something) if either endpoint was full.  what would be nicer is to
        // create a dedicated 'error' object.
        if (_p) {
            if (_p.source == null && _p.sourceEndpoint == null) {
                log("Cannot establish connection - source does not exist")
                return
            }
            if (_p.target == null && _p.targetEndpoint == null) {
                log("Cannot establish connection - target does not exist")
                return
            }

            // create the connection.  it is not yet registered
            jpc = this._newConnection(_p)

            // now add it the model, fire an event, and redraw

            this._finaliseConnection(jpc, _p)
        }


        return jpc
    }

    private _prepareConnectionParams(params:ConnectParams, referenceParams?:ConnectParams):InternalConnectParams {

        let _p:InternalConnectParams = extend({ }, params)
        if (referenceParams) {
            extend(_p, referenceParams)
        }

        // wire endpoints passed as source or target to sourceEndpoint/targetEndpoint, respectively.
        if (_p.source) {
            if ((_p.source as Endpoint).endpoint) {
                _p.sourceEndpoint = (_p.source as Endpoint)
            }
        }
        if (_p.target) {
            if ((_p.target as Endpoint).endpoint) {
                _p.targetEndpoint = (_p.target as Endpoint)
            }
        }

        // test for endpoint uuids to connect
        if (params.uuids) {
            _p.sourceEndpoint = this.getEndpoint(params.uuids[0])
            _p.targetEndpoint = this.getEndpoint(params.uuids[1])
        }

        // now ensure that if we do have Endpoints already, they're not full.
        // source:
        if (_p.sourceEndpoint && _p.sourceEndpoint.isFull()) {
            log("could not add connection; source endpoint is full")
            return
        }

        // target:
        if (_p.targetEndpoint && _p.targetEndpoint.isFull()) {
            log("could not add connection; target endpoint is full")
            return
        }

        // if source endpoint mandates connection type and nothing specified in our params, use it.
        if (!_p.type && _p.sourceEndpoint) {
            _p.type = _p.sourceEndpoint.connectionType
        }

        // copy in any connectorOverlays that were specified on the source endpoint.
        // it doesnt copy target endpoint overlays.  i'm not sure if we want it to or not.
        if (_p.sourceEndpoint && _p.sourceEndpoint.connectorOverlays) {
            _p.overlays = _p.overlays || []
            for (let i = 0, j = _p.sourceEndpoint.connectorOverlays.length; i < j; i++) {
                _p.overlays.push(_p.sourceEndpoint.connectorOverlays[i])
            }
        }

        // scope
        if (_p.sourceEndpoint && _p.sourceEndpoint.scope) {
            _p.scope = _p.sourceEndpoint.scope
        }

        // pointer events
        if (!_p["pointer-events"] && _p.sourceEndpoint && _p.sourceEndpoint.connectorPointerEvents) {
            _p["pointer-events"] = _p.sourceEndpoint.connectorPointerEvents
        }

        let _addEndpoint = (el:any, def?:any, idx?:number):Endpoint | Array<Endpoint> => {
            const params = _mergeOverrides(def, {
                anchor: _p.anchors ? _p.anchors[idx] : _p.anchor,
                endpoint: _p.endpoints ? _p.endpoints[idx] : _p.endpoint,
                paintStyle: _p.endpointStyles ? _p.endpointStyles[idx] : _p.endpointStyle,
                hoverPaintStyle: _p.endpointHoverStyles ? _p.endpointHoverStyles[idx] : _p.endpointHoverStyle,
                portId: _p.ports ? _p.ports[idx] : null
            })
            return this.addEndpoint(el, params)
        }

        // check for makeSource/makeTarget specs.

        let _oneElementDef = (type:string, idx:number, matchType:string, portId:string) => {
            // `type` is "source" or "target". Check that it exists, and is not already an Endpoint.
            if (_p[type] && !_p[type].endpoint && !_p[type + "Endpoint"] && !_p.newConnection) {

                let elDefs = _p[type][type === Constants.SOURCE ? Constants.SOURCE_DEFINITION_LIST : Constants.TARGET_DEFINITION_LIST]
                if (elDefs) {
                    let defIdx = findWithFunction(elDefs, (d:any) => {

                        //return (d.def.connectionType == null || d.def.connectionType === matchType) && (portId == null || d.def.portId === portId)

                        return (d.def.connectionType == null || d.def.connectionType === matchType) && (d.def.portId == null || d.def.portId == portId)
                        //return (d.def.portId == null || d.def.portId == portId)
                    })
                    if (defIdx >= 0) {

                        let tep = elDefs[defIdx]

                        if (tep) {
                            // if not enabled, return.
                            if (!tep.enabled) {
                                return false
                            }

                            const epDef = extend({}, tep.def)
                            delete epDef.label

                            let newEndpoint = tep.endpoint != null ? tep.endpoint : _addEndpoint(_p[type], epDef, idx)
                            if (newEndpoint.isFull()) {
                                return false
                            }
                            _p[type + "Endpoint"] = newEndpoint
                            if (!_p.scope && epDef.scope) {
                                _p.scope = epDef.scope
                            } // provide scope if not already provided and endpoint def has one.
                            if (tep.uniqueEndpoint) {
                                if (!tep.endpoint) {
                                    tep.endpoint = newEndpoint
                                    newEndpoint.deleteOnEmpty = false
                                }
                                else {
                                    newEndpoint.finalEndpoint = tep.endpoint
                                }
                            } else {
                                newEndpoint.deleteOnEmpty = true
                            }

                            //
                            // copy in connector overlays if present on the source definition.
                            //
                            if (idx === 0 && epDef.connectorOverlays) {
                                _p.overlays = _p.overlays || []
                                Array.prototype.push.apply(_p.overlays, epDef.connectorOverlays)
                            }
                        }
                    }
                }
            }
        }

        if (_oneElementDef(Constants.SOURCE, 0, _p.type || Constants.DEFAULT, _p.ports ? _p.ports[0] : null) === false) {
            return
        }
        if (_oneElementDef(Constants.TARGET, 1, _p.type || Constants.DEFAULT, _p.ports ? _p.ports[1] : null) === false) {
            return
        }

        // last, ensure scopes match
        if (_p.sourceEndpoint && _p.targetEndpoint) {
            if (!_scopeMatch(_p.sourceEndpoint, _p.targetEndpoint)) {
                _p = null
            }
        }
        return _p
    }

    _newConnection (params:any):Connection {
        params.id = "con_" + this._idstamp()
        const c = new Connection(this, params)
        c.paint()
        return c
    }

    //
    // adds the connection to the backing model, fires an event if necessary and then redraws
    //
    _finaliseConnection(jpc:Connection, params?:any, originalEvent?:Event, doInformAnchorManager?:boolean):void {

        params = params || {}
        // add to list of connections (by scope).
        if (!jpc.suspendedEndpoint) {
            this.connections.push(jpc)
        }

        jpc.pending = null

        // turn off isTemporarySource on the source endpoint (only viable on first draw)
        jpc.endpoints[0].isTemporarySource = false

        // always inform the anchor manager
        // except that if jpc has a suspended endpoint it's not true to say the
        // connection is new; it has just (possibly) moved. the question is whether
        // to make that call here or in the anchor manager.  i think perhaps here.
        if (doInformAnchorManager !== false) {
            this.router.newConnection(jpc)
        }

        // force a paint
        this._draw(jpc.source)

        // fire an event
        if (!params.doNotFireConnectionEvent && params.fireEvent !== false) {

            let eventArgs = {
                connection: jpc,
                source: jpc.source, target: jpc.target,
                sourceId: jpc.sourceId, targetId: jpc.targetId,
                sourceEndpoint: jpc.endpoints[0], targetEndpoint: jpc.endpoints[1]
            }

            this.fire(Constants.EVENT_CONNECTION, eventArgs, originalEvent)
        }
    }

    removeAllEndpoints(el:jsPlumbElement, recurse?:boolean, affectedElements?:Array<jsPlumbElement>):JsPlumbInstance {
        affectedElements = affectedElements || []
        let _one = (_el:jsPlumbElement) => {
            let id = this.getId(_el),
                ebe = this.endpointsByElement[id],
                i, ii

            if (ebe) {
                affectedElements.push(_el)
                for (i = 0, ii = ebe.length; i < ii; i++) {
                    this.deleteEndpoint(ebe[i])
                }
            }
            delete this.endpointsByElement[id]

            // TODO DOM specific
            if (recurse) {
                if (_el && (<any>_el).nodeType !== 3 && (<any>_el).nodeType !== 8) {
                    for (i = 0, ii = (<any>_el).childNodes.length; i < ii; i++) {
                        if ((<any>_el).childNodes[i].nodeType !== 3 && (<any>_el).childNodes[i].nodeType !== 8)
                        _one((<any>_el).childNodes[i])
                    }
                }
            }

        }
        _one(el)
        return this
    }

    private _setEnabled (type:string, el:jsPlumbElement, state:boolean, toggle?:boolean, connectionType?:string):any {
        let originalState:Array<any> = [], newState, os

        connectionType = connectionType || Constants.DEFAULT

        let defs = type === Constants.SOURCE ? el._jsPlumbSourceDefinitions : el._jsPlumbTargetDefinitions
        if (defs) {
            defs.forEach((def: SourceOrTargetDefinition) => {
                if (def.def.connectionType == null || def.def.connectionType === connectionType) {
                    os = def.enabled
                    originalState.push(os)
                    newState = toggle ? !os : state
                    def.enabled = newState
                    const cls = ["jtk", type, "disabled"].join("-")
                    if (newState) {
                        this.removeClass(el, cls)
                    } else {
                        this.addClass(el, cls)
                    }
                }
            })
        }

        return originalState.length > 1 ? originalState : originalState[0]

    }

    toggleSourceEnabled (el:jsPlumbElement, connectionType?:string):any {
        this._setEnabled(Constants.SOURCE, el, null, true, connectionType)
        return this.isSourceEnabled(el, connectionType)
    }

    setSourceEnabled (el:jsPlumbElement, state:boolean, connectionType?:string):any {
        return this._setEnabled(Constants.SOURCE, el, state, null, connectionType)
    }

    findFirstSourceDefinition(el:jsPlumbElement, connectionType?:string):SourceDefinition {
        return this.findFirstDefinition(Constants.SOURCE_DEFINITION_LIST, el, connectionType)
    }

    findFirstTargetDefinition(el:jsPlumbElement, connectionType?:string):TargetDefinition {
        return this.findFirstDefinition(Constants.TARGET_DEFINITION_LIST, el, connectionType)
    }

    private findFirstDefinition<T>(key:string, el:jsPlumbElement, connectionType?:string):T {
        if (el == null) {
            return null
        } else {
            const eldefs = el[key]
            if (eldefs && eldefs.length > 0) {
                let idx = connectionType == null ? 0 : findWithFunction(eldefs, (d: any) => {
                    return d.def.connectionType === connectionType
                })
                if (idx >= 0) {
                    return eldefs[0]
                }
            }
        }
    }

    isSource (el:jsPlumbElement, connectionType?:string):any {
        return this.findFirstSourceDefinition(el, connectionType) != null
    }

    isSourceEnabled (el:jsPlumbElement, connectionType?:string):boolean {
        let def = this.findFirstSourceDefinition(el, connectionType)
        return def != null && def.enabled !== false
    }

    toggleTargetEnabled(el:jsPlumbElement, connectionType?:string):any {
        this._setEnabled(Constants.TARGET, el, null, true, connectionType)
        return this.isTargetEnabled(el, connectionType)
    }

    isTarget(el:jsPlumbElement, connectionType?:string):boolean {
        return this.findFirstTargetDefinition(el, connectionType) != null
    }

    isTargetEnabled (el:jsPlumbElement, connectionType?:string):boolean {
        let def = this.findFirstTargetDefinition(el, connectionType)
        return def != null && def.enabled !== false
    }

    setTargetEnabled(el:jsPlumbElement, state:boolean, connectionType?:string):any {
        return this._setEnabled(Constants.TARGET, el, state, null, connectionType)
    }

    // really just exposed for testing
    makeAnchor(spec:AnchorSpec, elementId?:string):Anchor {
        return makeAnchorFromSpec(this, spec, elementId)
    }

    private _unmake (type:string, key:string, el:jsPlumbElement, connectionType?:string) {

        connectionType = connectionType || "*"

        if (el[key]) {
            if (connectionType === "*") {
                delete el[key]
                this.removeAttribute(el, "jtk-" + type)
            } else {
                let t: Array<any> = []
                el[key].forEach((def: any) => {
                    if (connectionType !== def.def.connectionType) {
                        t.push(def)
                    }
                })

                if (t.length > 0) {
                    el[key] = t
                } else {
                    delete el[key]
                    this.removeAttribute(el, "jtk-" + type)
                }
            }
        }
    }

    private _unmakeEvery (type:string, key:string, connectionType?:string) {
        let els = this.getSelector("[jtk-" + type + "]")
        for (let i = 0; i < els.length; i++) {
            this._unmake(type, key, els[i], connectionType)
        }
    }

    // see api docs
    unmakeTarget (el:jsPlumbElement, connectionType?:string) {
        return this._unmake(Constants.TARGET, Constants.TARGET_DEFINITION_LIST, el, connectionType)
    }

    // see api docs
    unmakeSource (el:jsPlumbElement, connectionType?:string) {
        return this._unmake(Constants.SOURCE, Constants.SOURCE_DEFINITION_LIST, el, connectionType)
    }

    // see api docs
    unmakeEverySource (connectionType?:string) {
        this._unmakeEvery(Constants.SOURCE, Constants.SOURCE_DEFINITION_LIST, connectionType || "*")
    }

    // see api docs
    unmakeEveryTarget (connectionType?:string) {
        this._unmakeEvery(Constants.TARGET, Constants.TARGET_DEFINITION_LIST, connectionType || "*")
    }

    private _writeScopeAttribute (el:jsPlumbElement, scope:string):void {
        let scopes = scope.split(/\s/)
        for (let i = 0; i < scopes.length; i++) {
            this.setAttribute(el, "jtk-scope-" + scopes[i], "")
        }
    }

    // TODO knows about the DOM (? does it?)
    makeSource(el:jsPlumbElement, params?:BehaviouralTypeDescriptor, referenceParams?:any):JsPlumbInstance {
        let p = extend({_jsPlumb: this}, referenceParams)
        extend(p, params)
        p.connectionType = p.connectionType || Constants.DEFAULT
        let aae = this.deriveEndpointAndAnchorSpec(p.connectionType)
        p.endpoint = p.endpoint || aae.endpoints[0]
        p.anchor = p.anchor || aae.anchors[0]
        let maxConnections = p.maxConnections || -1

        this.manage(el)
        this.setAttribute(el, Constants.ATTRIBUTE_SOURCE, "")
        this._writeScopeAttribute(el, (p.scope || this.Defaults.scope))
        this.setAttribute(el, [ Constants.ATTRIBUTE_SOURCE, p.connectionType].join("-"), "")

        el._jsPlumbSourceDefinitions = el._jsPlumbSourceDefinitions || []

        let _def:SourceDefinition = {
            def:extend({}, p),
            uniqueEndpoint: p.uniqueEndpoint,
            maxConnections: maxConnections,
            enabled: true,
            endpoint:null as Endpoint
        }

        if (p.createEndpoint) {
            _def.uniqueEndpoint = true
            _def.endpoint = this.addEndpoint(el, _def.def)
            _def.endpoint.deleteOnEmpty = false
        }

        el._jsPlumbSourceDefinitions.push(_def)

        return this
    }

    private _getScope(el:jsPlumbElement, defKey:string):string {
        if (el[defKey] && el[defKey].length > 0) {
            return el[defKey][0].def.scope
        } else {
            return null
        }
    }

    getSourceScope(el:jsPlumbElement):string {
        return this._getScope(el, Constants.SOURCE_DEFINITION_LIST)
    }

    getTargetScope(el:jsPlumbElement):string {
        return this._getScope(el, Constants.TARGET_DEFINITION_LIST)
    }

    getScope(el:jsPlumbElement):string {
        return this.getSourceScope(el) || this.getTargetScope(el)
    }

    private _setScope(el:jsPlumbElement, scope:string, defKey:string):void {
        if (el[defKey]) {
            el[defKey].forEach((def:any) => def.def.scope = scope)
        }
    }

    setSourceScope(el:jsPlumbElement, scope:string):void {
        this._setScope(el, scope, Constants.SOURCE_DEFINITION_LIST)
    }

    setTargetScope(el:jsPlumbElement, scope:string):void {
        this._setScope(el, scope, Constants.TARGET_DEFINITION_LIST)
    }

    setScope(el:jsPlumbElement, scope:string):void {
        this._setScope(el, scope, Constants.SOURCE_DEFINITION_LIST)
        this._setScope(el, scope, Constants.TARGET_DEFINITION_LIST)
    }

    makeTarget (el:jsPlumbElement, params:BehaviouralTypeDescriptor, referenceParams?:any):JsPlumbInstance {

        // put jsplumb ref into params without altering the params passed in
        let p = extend({_jsPlumb: this}, referenceParams)
        extend(p, params)
        p.connectionType  = p.connectionType || Constants.DEFAULT

        let maxConnections = p.maxConnections || -1;//,

        let dropOptions = extend({}, p.dropOptions || {})

        this.manage(el)
        this.setAttribute(el, Constants.ATTRIBUTE_TARGET, "")
        this._writeScopeAttribute(el, (p.scope || this.Defaults.scope))
        this.setAttribute(el, [Constants.ATTRIBUTE_TARGET, p.connectionType].join("-"), "")

        el._jsPlumbTargetDefinitions = el._jsPlumbTargetDefinitions || []

        // if this is a group and the user has not mandated a rank, set to -1 so that Nodes takes
        // precedence.
        if (el._jsPlumbGroup && dropOptions.rank == null) {
            dropOptions.rank = -1
        }

        // store the definition
        let _def = {
            def: extend({}, p),
            uniqueEndpoint: p.uniqueEndpoint,
            maxConnections: maxConnections,
            enabled: true,
            endpoint:null as Endpoint
        }

        if (p.createEndpoint) {
            _def.uniqueEndpoint = true
            _def.endpoint = this.addEndpoint(el, _def.def)
            _def.endpoint.deleteOnEmpty = false
        }

        el._jsPlumbTargetDefinitions.push(_def)

        return this
    }

    show (el:jsPlumbElement, changeEndpoints?:boolean):JsPlumbInstance {
        return this._setVisible(el, Constants.BLOCK, changeEndpoints)
    }

    hide (el:jsPlumbElement, changeEndpoints?:boolean):JsPlumbInstance {
        return this._setVisible(el, Constants.NONE, changeEndpoints)
    }

    private _setVisible (el:jsPlumbElement, state:string, alsoChangeEndpoints?:boolean) {
        let visible = state === Constants.BLOCK
        let endpointFunc = null
        if (alsoChangeEndpoints) {
            endpointFunc = (ep:Endpoint) => {
                ep.setVisible(visible, true, true)
            }
        }
        let id = this.getId(el)
        this._operation(el, (jpc:Connection) => {
            if (visible && alsoChangeEndpoints) {
                // this test is necessary because this functionality is new, and i wanted to maintain backwards compatibility.
                // this block will only set a connection to be visible if the other endpoint in the connection is also visible.
                let oidx = jpc.sourceId === id ? 1 : 0
                if (jpc.endpoints[oidx].isVisible()) {
                    jpc.setVisible(true)
                }
            }
            else { // the default behaviour for show, and what always happens for hide, is to just set the visibility without getting clever.
                jpc.setVisible(visible)
            }
        }, endpointFunc)

        return this
    }

    /**
     * private method to do the business of toggling hiding/showing.
     */
    toggleVisible (el:jsPlumbElement, changeEndpoints?:boolean) {
        let endpointFunc = null
        if (changeEndpoints) {
            endpointFunc = (ep:Endpoint) => {
                let state = ep.isVisible()
                ep.setVisible(!state)
            }
        }
        this._operation(el,  (jpc:Connection) => {
            let state = jpc.isVisible()
            jpc.setVisible(!state)
        }, endpointFunc)
    }

    private _operation (el:jsPlumbElement, func:(c:Connection) => any, endpointFunc?:(e:Endpoint) => any) {
        let elId = this.getId(el)
        let endpoints = this.endpointsByElement[elId]
        if (endpoints && endpoints.length) {
            for (let i = 0, ii = endpoints.length; i < ii; i++) {
                for (let j = 0, jj = endpoints[i].connections.length; j < jj; j++) {
                    let retVal = func(endpoints[i].connections[j])
                    // if the function passed in returns true, we exit.
                    // most functions return false.
                    if (retVal) {
                        return
                    }
                }
                if (endpointFunc) {
                    endpointFunc(endpoints[i])
                }
            }
        }
    }

    registerConnectionType(id:string, type:TypeDescriptor):void {
        this._connectionTypes[id] = extend({}, type)
        if (type.overlays) {
            let to:Dictionary<FullOverlaySpec> = {}
            for (let i = 0; i < type.overlays.length; i++) {
                // if a string, convert to object representation so that we can store the typeid on it.
                // also assign an id.
                let fo = this.convertToFullOverlaySpec(type.overlays[i])
                to[fo[1].id] = fo
            }
            //this._connectionTypes[id].overlayMap = to
            this._connectionTypes[id].overlays = to as any
        }
    }

    registerConnectionTypes(types:Dictionary<TypeDescriptor>) {
        for (let i in types) {
            this.registerConnectionType(i, types[i])
        }
    }

    registerEndpointType(id:string, type:TypeDescriptor) {
        this._endpointTypes[id] = extend({}, type)
        if (type.overlays) {
            let to:Dictionary<FullOverlaySpec> = {}
            for (let i = 0; i < type.overlays.length; i++) {
                // if a string, convert to object representation so that we can store the typeid on it.
                // also assign an id.
                let fo = this.convertToFullOverlaySpec(type.overlays[i])
                to[fo[1].id] = fo
            }
            this._endpointTypes[id].overlays = to as any
        }
    }

    registerEndpointTypes(types:Dictionary<TypeDescriptor>) {
        for (let i in types) {
            this.registerEndpointType(i, types[i])
        }
    }

    getType(id:string, typeDescriptor:string):TypeDescriptor {
        return typeDescriptor === "connection" ? this._connectionTypes[id] : this._endpointTypes[id]
    }

    importDefaults(d:jsPlumbDefaults):JsPlumbInstance {
        for (let i in d) {
            this.Defaults[i] = d[i]
        }
        if (d.container) {
            this.setContainer(d.container)
        }

        return this
    }

    restoreDefaults ():JsPlumbInstance {
        this.Defaults = extend({}, this._initialDefaults)
        return this
    }

    getManagedElements():Dictionary<ManagedElement> {
        return this._managedElements
    }

// ----------------------------- proxy connections -----------------------

    proxyConnection(connection:Connection, index:number,
                    proxyEl:jsPlumbElement, proxyElId:string,
                    endpointGenerator:any, anchorGenerator:any) {

        let alreadyProxied = connection.proxies[index] != null,
            proxyEp,
            originalElementId = alreadyProxied ? connection.proxies[index].originalEp.elementId : connection.endpoints[index].elementId,
            originalEndpoint = alreadyProxied ? connection.proxies[index].originalEp : connection.endpoints[index]

        // if proxies exist for this end of the connection
        if(connection.proxies[index]) {
            // and the endpoint is for the element we're going to proxy to, just use it.
            if (connection.proxies[index].ep.elementId === proxyElId) {
                proxyEp = connection.proxies[index].ep
            } else {
                // otherwise detach that previous endpoint; it will delete itself
                connection.proxies[index].ep.detachFromConnection(connection, index)
                proxyEp = this.addEndpoint(proxyEl, {
                    endpoint:endpointGenerator(connection, index),
                    anchor:anchorGenerator(connection, index),
                    parameters:{
                        isProxyEndpoint:true
                    }
                })
            }
        }else {
            proxyEp = this.addEndpoint(proxyEl, {
                endpoint:endpointGenerator(connection, index),
                anchor:anchorGenerator(connection, index),
                parameters:{
                    isProxyEndpoint:true
                }
            })
        }
        proxyEp.deleteOnEmpty = true

        // for this index, stash proxy info: the new EP, the original EP.
        connection.proxies[index] = { ep:proxyEp, originalEp: originalEndpoint }

        // and advise the anchor manager
        this.sourceOrTargetChanged(originalElementId, proxyElId, connection, proxyEl, index)

        // detach the original EP from the connection, but mark as a transient detach.
        originalEndpoint.detachFromConnection(connection, null, true)

        // set the proxy as the new ep
        proxyEp.connections = [ connection ]
        connection.endpoints[index] = proxyEp

        originalEndpoint.setVisible(false)

        connection.setVisible(true)

        this.revalidate(proxyEl)
    }

    unproxyConnection(connection:Connection, index:number, proxyElId:string) {
        // if connection cleaned up, no proxies, or none for this end of the connection, abort.
        if (connection.proxies == null || connection.proxies[index] == null) {
            return
        }

        let originalElement = connection.proxies[index].originalEp.element,
            originalElementId = connection.proxies[index].originalEp.elementId

        connection.endpoints[index] = connection.proxies[index].originalEp

        this.sourceOrTargetChanged(proxyElId, originalElementId, connection, originalElement, index)

        // detach the proxy EP from the connection (which will cause it to be removed as we no longer need it)
        connection.proxies[index].ep.detachFromConnection(connection, null)

        connection.proxies[index].originalEp.addConnection(connection)
        if(connection.isVisible()) {
            connection.proxies[index].originalEp.setVisible(true)
        }

        // cleanup
        connection.proxies[index] = null

        // if both empty, set length to 0.
        if (connection.proxies.find((p:any) => p != null) == null) {
            connection.proxies.length = 0
        }
    }

    sourceOrTargetChanged (originalId:string, newId:string, connection:any, newElement:any, index:number):void {
        if (index === 0) {
            if (originalId !== newId) {
                connection.sourceId = newId
                connection.source = newElement
                connection.updateConnectedClass()
            }
        } else if (index === 1) {
            connection.targetId = newId
            connection.target = newElement
            connection.updateConnectedClass()
        }
    }

// ------------------------ GROUPS --------------

    getGroup(groupId:string) { return this.groupManager.getGroup(groupId); }
    getGroupFor(el:jsPlumbElement) { return this.groupManager.getGroupFor(el); }
    addGroup(params:AddGroupOptions) { return this.groupManager.addGroup(params); }
    addToGroup(group:string | UIGroup, el:any | Array<any>, doNotFireEvent?:boolean) { return this.groupManager.addToGroup(group, el, doNotFireEvent); }

    collapseGroup (group:string | UIGroup) { this.groupManager.collapseGroup(group); }
    expandGroup (group:string | UIGroup) { this.groupManager.expandGroup(group); }
    toggleGroup (group:string | UIGroup) { this.groupManager.toggleGroup(group); }

    removeGroup(group:string | UIGroup, deleteMembers?:boolean, manipulateDOM?:boolean, doNotFireEvent?:boolean) {
        this.groupManager.removeGroup(group, deleteMembers, manipulateDOM, doNotFireEvent)
    }

    removeAllGroups(deleteMembers?:boolean, manipulateDOM?:boolean, doNotFireEvent?:boolean) {
        this.groupManager.removeAllGroups(deleteMembers, manipulateDOM, doNotFireEvent)
    }
    removeFromGroup (group:string | UIGroup, el:any, doNotFireEvent?:boolean):void {
        this.groupManager.removeFromGroup(group, el, doNotFireEvent)
        this.appendElement(el, this.getContainer())
        this.updateOffset({recalc:true, elId:this.getId(el)})
    }

    abstract getElement(el:any|string):any
    abstract getElementById(el:string):any
    abstract removeElement(el:any):void
    abstract appendElement (el:any, parent:any):void

    abstract removeClass(el:any, clazz:string):void
    abstract addClass(el:any, clazz:string):void
    abstract toggleClass(el:any, clazz:string):void
    abstract getClass(el:any):string
    abstract hasClass(el:any, clazz:string):boolean

    abstract setAttribute(el:any, name:string, value:string):void
    abstract getAttribute(el:any, name:string):string
    abstract setAttributes(el:any, atts:Dictionary<string>):void
    abstract removeAttribute(el:any, attName:string):void

    abstract getSelector(ctx:string | any, spec?:string):NodeListOf<any>
    abstract getStyle(el:any, prop:string):any

    abstract _getSize(el:any):Size

    abstract _getOffset(el:any|string):Offset
    abstract _getOffsetRelativeToRoot(el:any|string):Offset

    abstract setPosition(el:any, p:Offset):void

    abstract on (el:any, event:string, callbackOrSelector:Function | string, callback?:Function):void
    abstract off (el:any, event:string, callback:Function):void
    abstract trigger(el:any, event:string, originalEvent?:Event, payload?:any):void

    abstract getPath(segment:Segment, isFirstSegment:boolean):string

    abstract paintOverlay(o: Overlay, params:any, extents:any):void
    abstract addOverlayClass(o:Overlay, clazz:string):void
    abstract removeOverlayClass(o:Overlay, clazz:string):void
    abstract setOverlayVisible(o: Overlay, visible:boolean):void
    abstract destroyOverlay(o: Overlay, force?:boolean):void
    abstract updateLabel(o:LabelOverlay):void
    abstract drawOverlay(overlay:Overlay, component:any, paintStyle:PaintStyle, absolutePosition?:PointArray):any
    abstract moveOverlayParent(o:Overlay, newParent:any):void
    abstract reattachOverlay(o:Overlay, c:OverlayCapableComponent):any
    abstract setOverlayHover(o:Overlay, hover:boolean):any

    abstract setHover(component:Component, hover:boolean):void

    abstract paintConnector(connector:AbstractConnector, paintStyle:PaintStyle, extents?:any):void
    abstract destroyConnection(connection:Connection, force?:boolean):void
    abstract setConnectorHover(connector:AbstractConnector, h:boolean, doNotCascade?:boolean):void
    abstract addConnectorClass(connector:AbstractConnector, clazz:string):void
    abstract removeConnectorClass(connector:AbstractConnector, clazz:string):void
    abstract getConnectorClass(connector:AbstractConnector):string
    abstract setConnectorVisible(connector:AbstractConnector, v:boolean):void
    abstract applyConnectorType(connector:AbstractConnector, t:TypeDescriptor):void

    abstract applyEndpointType(ep:Endpoint, t:TypeDescriptor):void
    abstract setEndpointVisible(ep:Endpoint, v:boolean):void
    abstract destroyEndpoint(ep:Endpoint):void
    abstract paintEndpoint(ep:Endpoint, paintStyle:PaintStyle):void
    abstract addEndpointClass(ep:Endpoint, c:string):void
    abstract removeEndpointClass(ep:Endpoint, c:string):void
    abstract getEndpointClass(ep:Endpoint):string
    abstract setEndpointHover(endpoint: Endpoint, h: boolean, doNotCascade?:boolean): void
    abstract refreshEndpoint(endpoint:Endpoint):void

}
