/*\
title: $:/plugins/rimir/namespace/pseudo/_latest.js
type: application/javascript
module-type: rimir-ns-pseudo

Pseudo-segment `_latest` — resolves to the highest-version immediate
child of the preceding prefix.

A "version" is a plain dotted-numeric string optionally suffixed with
`-prerelease`. Examples: `1`, `3.0`, `4.0.3`, `1.0-beta`, `2.0.0-rc.1`.
Comparison is numeric per segment (missing = 0), with releases sorting
above their prereleases. Non-version siblings are ignored.

Returns null if the prefix is empty (no anchor for version lookup) or
no version-shaped children exist.

\*/

"use strict";

var util = require("$:/plugins/rimir/namespace/resolver.js");

exports.name = "_latest";

var RE_VERSION = /^\d+(\.\d+)*(-[\w.]+)?$/;

function isVersion(s) {
	return typeof s === "string" && RE_VERSION.test(s);
}

function compareVersions(a, b) {
	var aParts = a.split("-"),
		bParts = b.split("-"),
		aNums = aParts[0].split("."),
		bNums = bParts[0].split("."),
		len = Math.max(aNums.length, bNums.length);
	for(var i = 0; i < len; i++) {
		var aN = parseInt(aNums[i] || "0", 10),
			bN = parseInt(bNums[i] || "0", 10);
		if(aN !== bN) { return aN - bN; }
	}
	var aPre = aParts.slice(1).join("-"),
		bPre = bParts.slice(1).join("-");
	if(!aPre && !bPre) { return 0; }
	if(!aPre) { return 1; }   // release > prerelease
	if(!bPre) { return -1; }
	return aPre < bPre ? -1 : (aPre > bPre ? 1 : 0);
}

exports.resolve = function(prefix, wiki) {
	if(!prefix) { return null; }
	var versions = util.listImmediateChildren(prefix, wiki).filter(isVersion);
	if(!versions.length) { return null; }
	versions.sort(compareVersions);
	return versions[versions.length - 1];
};
