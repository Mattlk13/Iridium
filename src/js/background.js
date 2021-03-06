"use strict";

const GET_BROADCAST_ID = 0;
const YT_PATTERN = "*://www.youtube.com/*";
const YT_FP_DOMAIN = "youtube.com";
const YT_URL = "http://." + YT_FP_DOMAIN;
const YT_PREF_COOKIE = "PREF";

let fpi;
let api;
let util;
let settings;

settings = window.defaultSettings || {};

browser
    .privacy
    .websites
    .firstPartyIsolate
    .get({})
    .then(function (got) {
        fpi = got.value;
    });

util = {
    videoIdPattern: /v=([\w-_]+)/,
    generateUUID: function () {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(
            /[018]/g,
            function (point) {
                return (point ^ window.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> point / 4).toString(16);
            }
        );
    },
    filterCacheData: function (data) {
        return data != null && data.startsWith("\u0000") ? data.split("\u0000").pop() : data;
    },
    filterResponse: function (requestId) {
        return chrome.webRequest.filterResponseData(requestId);
    },
    filterEngine: function (
        details,
        modifier
    ) {

        let str;
        let filter;
        let decoder;
        let encoder;

        str = "";
        decoder = new TextDecoder("utf-8");
        encoder = new TextEncoder();
        filter = util.filterResponse(details.requestId);

        filter.ondata = function (event) {
            str += util.filterCacheData(decoder.decode(event.data, {stream: true}));
        };

        filter.onstop = function (event) {

            filter.write(encoder.encode(modifier(str)));
            filter.disconnect();

        };

    }
};

api = {
    broadcastId: util.generateUUID(),
    mainFrameListener: function (details) {

        if (details.frameId !== 0) {
            return {};
        }

        let modifier;

        modifier = function (str) {

            str = str.replace(
                /<head>/,
                `<head><script>(${window.main}("${api.broadcastId}",${JSON.stringify(settings)}))</script>`
            );

            str = str.replace(
                /(<g id="like">)/,
                "      <g id=\"autoplay\">\n" +
                "        <polygon data-iri-feature=\"autoPlayVideo\" points=\"7.4,4 21.2,12 7.4,20\"></polygon>\n" +
                "      </g>\n" +
                "      $1"
            );

            if (!settings.autoPlayVideo) {
                str = str
                    .replace(
                        /ytplayer\.load\(\);/,
                        ""
                    )
                    .replace(
                        /disable_new_pause_state3=true/g,
                        "disable_new_pause_state3=false"
                    )
                ;
            }

            return str;

        };

        util.filterEngine(details, modifier);

    },
    scriptListener: function (details) {

        if (details.frameId !== 0) {
            return {};
        }

        let modifier;

        modifier = function (str) {

            if (details.url.endsWith("/base.js")) {
                str = str
                    .replace(
                        /"loadVideoByPlayerVars",this\.loadVideoByPlayerVars/,
                        "\"loadVideoByPlayerVars\",window.modifier.bind(this,this.loadVideoByPlayerVars)"
                    )
                    .replace(
                        /"cueVideoByPlayerVars",this\.cueVideoByPlayerVars/,
                        "\"cueVideoByPlayerVars\",window.modifier.bind(this,this.cueVideoByPlayerVars)"
                    )
                    .replace(
                        /([a-z0-9.]+)(.style\.backgroundImage=\n?([a-z0-9]+)\?"url\("\+[a-z0-9]+\+"\)":"";?)/gi,
                        "$&;(" + window.imageLoader.toString().replace(/(\$[$&`'0-9]+)/g, "$$$1") + "($1,$3));"
                    )
                    .replace(
                        /(this\.[a-z0-9]+)=[^;]+\.autoplayoverride\);/i,
                        "$1=window.autoPlayVideo;"
                    )
                ;
            } else {

                str = str
                    .replace(
                        /(\.onDone=function\(([a-z0-9]+)\){)/gi,
                        "$1(" + window.pbjMod + "($2));"
                    )
                    .replace(
                        /(updatePageData_:function\(([a-z0-9]+)\){)/gi,
                        "$1(window.pageModifier($2));"
                    )
                    .replace(
                        /([a-z0-9.]+)loadVideoByPlayerVars\(([^)]+)\)/gi,
                        "(window.autoPlayVideo!==false?$1loadVideoByPlayerVars($2):$1cueVideoByPlayerVars($2))"
                    )
                ;

                if (!settings.autoPlayVideo) {
                    str = str
                        .replace(
                            /config_\.loaded=!0/g,
                            "config_.loaded=!1"
                        )
                    ;
                }

            }

            return str;

        };

        util.filterEngine(details, modifier);

    },
    headersListener: function (details) {

        if (details.frameId !== 0 ||
            details.type !== "main_frame"
        ) {
            return {requestHeaders: details.requestHeaders};
        }

        function setCookieValue(originalValue) {

            if (typeof originalValue !== 'string' &&
                !(originalValue instanceof String)
            ) {
                return "";
            }

            let decimal;

            decimal = parseInt(originalValue, 16);

            if (settings.darkTheme) {
                decimal = decimal & ~Math.pow(2, 19) | Math.pow(2, 10); //"41414"
            } else {
                decimal = decimal & ~Math.pow(2, 10) | Math.pow(2, 19); //"c1014"
            }

            return decimal.toString(16);

        }

        function processCookieValue(
            match,
            p1,
            p2,
            offset,
            string
        ) {

            if (!p1 || !p2) {
                return string;
            }

            return p1 + setCookieValue(p2);

        }

        function bakeCookie() {

            let date;

            date = new Date();

            return {
                expirationDate: Math.round(date.setFullYear(date.getFullYear() + 1) / 1000),
                firstPartyDomain: fpi ? YT_FP_DOMAIN : null,
                httpOnly: false,
                name: YT_PREF_COOKIE,
                path: "/",
                sameSite: "no_restriction",
                secure: false,
                storeId: details.cookieStoreId,
                value: "f6=400"
            };

        }

        function updateCookie(cookie) {

            if (!cookie) {
                cookie = bakeCookie();
            }

            chrome.cookies.set({
                expirationDate: cookie.expirationDate,
                firstPartyDomain: cookie.firstPartyDomain,
                httpOnly: cookie.httpOnly,
                name: cookie.name,
                path: cookie.path,
                sameSite: cookie.sameSite,
                secure: cookie.secure,
                storeId: cookie.storeId,
                url: YT_URL,
                value: cookie.value.replace(
                    /(f6=)([0-9a-z]+)/i,
                    processCookieValue
                )
            });

        }

        let values;
        let header;

        for (let i = 0; i < details.requestHeaders.length; i++) {

            if ((header = details.requestHeaders[i]).name.toLowerCase() !== "cookie") {
                continue;
            }

            if (!header.value.match(/PREF=/)) {

                // doesn't have pref cookie
                values = header.value.split(/; ?/);
                values.push("PREF=f6=" + setCookieValue("0"));
                header.value = values.join("; ");

            } else if (!header.value.match(/f6=[0-9]+/)) {

                // doesn't have f6 group setting
                values = header.value.match(/PREF=([^;|$]+)/i);
                values = values ? values[1] : "";
                values = values.split("&");
                values.push("f6=" + setCookieValue("0"));
                header.value = header.value.replace(
                    /(PREF=)[^;|$]+/i,
                    "$1" + values.join("&")
                );

            } else {
                header.value = header.value.replace(
                    /(f6=)([0-9a-z]+)/i,
                    processCookieValue
                );
            }

            chrome.cookies.get({
                    storeId: details.cookieStoreId,
                    firstPartyDomain: fpi ? YT_FP_DOMAIN : null,
                    name: YT_PREF_COOKIE,
                    url: YT_URL
                },
                updateCookie
            );

            return {requestHeaders: details.requestHeaders};

        }

        // no cookies header, add it
        details.requestHeaders.push({
            name: "cookie",
            value: "PREF=f6=" + setCookieValue("0")
        });

        return {requestHeaders: details.requestHeaders};

    },
    iniRequestListeners: function () {

        const block = ["blocking"];
        const blockHeaders = ["blocking", "requestHeaders"];
        const headersFilter = {
            urls: [YT_PATTERN]
        };
        const mainFilter = {
            urls: [YT_PATTERN],
            types: ["main_frame"]
        };
        const scriptFilter = {
            urls: [
                YT_PATTERN + "/base.js",
                YT_PATTERN + "/desktop_polymer_v2.js",
                YT_PATTERN + "/desktop_polymer_sel_auto_svg_home_v2.js"
            ],
            types: ["script"]
        };

        chrome.webRequest.onBeforeSendHeaders.addListener(api.headersListener, headersFilter, blockHeaders);
        chrome.webRequest.onBeforeRequest.addListener(api.mainFrameListener, mainFilter, block);
        chrome.webRequest.onBeforeRequest.addListener(api.scriptListener, scriptFilter, block);

    },
    ini: function () {

        function onMessageListener(
            request,
            sender,
            sendResponse
        ) {

            if (request === GET_BROADCAST_ID) {

                sendResponse(api.broadcastId);
                return;

            }

            console.log(request);

            let data;

            for (let key in request) {

                if (!request.hasOwnProperty(key)) {
                    continue;
                }

                data = {};

                if (key in settings) {
                    if (request[key] !== settings[key]) {

                        settings[key] = request[key];
                        data[key] = settings[key];

                    }
                }

                if (Object.keys(data).length < 1) {
                    return;
                }

                chrome.storage.local.set(data, function (event) {
                    console.log("onMessageListener", event);
                });

            }

        }

        function onStorageChangedListener(
            changes,
            namespace
        ) {

            for (let key in changes) {
                if (changes.hasOwnProperty(key)) {
                    settings[key] = changes[key].newValue;
                }
            }

        }

        function onStorageGetListener(items) {
            settings = items;
        }

        function onBrowserActionClickedListener() {
            chrome.runtime.openOptionsPage();
        }

        chrome.runtime.onMessage.addListener(onMessageListener);
        chrome.storage.onChanged.addListener(onStorageChangedListener);
        chrome.storage.local.get(settings, onStorageGetListener);
        chrome.browserAction.onClicked.addListener(onBrowserActionClickedListener);

        this.iniRequestListeners();

    }
};

api.ini();