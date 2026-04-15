/*\
title: $:/plugins/rimir/namespace/resolver.js
type: application/javascript
module-type: library

Pure resolver for namespace-aware link references.

Resolution pipeline for a reference REF looked up from source tiddler SRC:

  0. Expand pseudo-segments — any segment beginning with "_" is looked up
                      in the pseudo-registry (module-type:
                      rimir-ns-pseudo). Matching resolvers are called with
                      (prefix, wiki) and return a replacement segment, or
                      null to fail expansion. Unknown _-prefixed segments
                      pass through unchanged (treated as literal).
  1. Literal        — expanded REF exists as-is (covers $:/… system titles).
  2. Absolute       — REF contains '/', looked up literally (same as #1
                      in current stages; meaningful once mount points land).
  3. Context prefix — if options.context is set (from \context pragma,
                      <$context> widget, or context field), try
                      "<context>/REF" before walk-up. Lets a tiddler
                      declare "resolve as if I lived under this prefix".
  4. Walk-up        — walk prefixes of SRC (excluding SRC's own last segment)
                      and try "<prefix>/REF" at each depth. First hit wins.
  5. Unresolved     — no candidate matched.

Pseudo-segments are pluggable: each resolver is its own JS module with
module-type `rimir-ns-pseudo`, exporting `name` (the full segment string
including leading underscore) and `resolve(prefix, wiki)`. See
`pseudo/_latest.js` for the reference implementation.

Pseudo lookups are cached per-wiki, keyed by (pseudoName, prefix). The
companion startup module walks every changed title's ancestor prefixes
and drops matching cache entries.

\*/

"use strict";

/* ---------- path helpers ---------- */

/*
Split a tiddler title into path segments on '/'. System titles ('$:/…')
keep "$:" as the first segment so walk-up can traverse within the system
namespace — enabling shadow-tiddler demos and plugin-internal links.
Walk-up stops at i>=2 for $:/ titles to avoid degenerate "$:/REF"
candidates that would match nothing useful.
*/
exports.splitPath = function(title) {
	if(!title) { return []; }
	if(title.indexOf("$:/") === 0) {
		var rest = title.substring(3);
		return rest ? ["$:"].concat(rest.split("/")) : ["$:"];
	}
	return title.split("/");
};

/*
Check whether a tiddler exists as a regular OR shadow tiddler. Shadow
tiddlers (from plugins like $:/core) must count as "resolved" or every
[[$:/ControlPanel]]-style link would be flagged unresolved.
*/
function exists(wiki, title) {
	return wiki.tiddlerExists(title) || (wiki.isShadowTiddler && wiki.isShadowTiddler(title));
}

/* ---------- utility for pseudo-resolvers ---------- */

/*
Return the set of immediate child segments under a given prefix, across
both regular and shadow tiddlers. Empty-string segments (trailing slashes)
are dropped.

This is the one enumeration primitive pseudo-resolvers should need: give
me what's directly below `<prefix>/`, filter/sort it however you like,
return one segment.
*/
exports.listImmediateChildren = function(prefix, wiki) {
	var children = Object.create(null),
		pfx = prefix + "/";
	function collect(tiddler, title) {
		if(title.indexOf(pfx) !== 0) { return; }
		var rest = title.substring(pfx.length),
			slashAt = rest.indexOf("/"),
			seg = slashAt === -1 ? rest : rest.substring(0, slashAt);
		if(seg) { children[seg] = true; }
	}
	if(wiki.each) { wiki.each(collect); }
	if(wiki.eachShadow) { wiki.eachShadow(collect); }
	return Object.keys(children);
};

/* ---------- pseudo-segment registry ---------- */

// Cached registry map: pseudoName → resolve(prefix, wiki)
var registry = null;

function getRegistry() {
	if(registry !== null) { return registry; }
	registry = Object.create(null);
	if($tw && $tw.modules && $tw.modules.getModulesByTypeAsHashmap) {
		var mods = $tw.modules.getModulesByTypeAsHashmap("rimir-ns-pseudo");
		for(var key in mods) {
			var mod = mods[key];
			if(mod && typeof mod.name === "string" && typeof mod.resolve === "function") {
				registry[mod.name] = mod.resolve;
			}
		}
	}
	return registry;
}

/*
Reset the registry. Useful if pseudo modules are added/removed at runtime
(rare — mostly for tests). Normal operation builds the registry once at
first use and keeps it.
*/
exports.resetPseudoRegistry = function() {
	registry = null;
};

/* ---------- pseudo result cache ---------- */

// WeakMap<wiki, Map<"<pseudoName>\x1f<prefix>", string|null>>
var caches = typeof WeakMap !== "undefined" ? new WeakMap() : null;
var CACHE_SEP = "\x1f";

function getCache(wiki) {
	if(!caches) { return null; }
	var c = caches.get(wiki);
	if(!c) {
		c = new Map();
		caches.set(wiki, c);
	}
	return c;
}

function cacheKey(pseudoName, prefix) {
	return pseudoName + CACHE_SEP + prefix;
}

/*
Drop cached pseudo results. If `prefix` is null/empty, clear all entries
for this wiki; otherwise drop every entry whose prefix part matches
exactly, across all pseudo names.
*/
exports.invalidatePseudoCache = function(prefix, wiki) {
	var cache = getCache(wiki);
	if(!cache) { return; }
	if(!prefix) {
		cache.clear();
		return;
	}
	var toDelete = [];
	cache.forEach(function(_value, key) {
		var sep = key.indexOf(CACHE_SEP);
		if(sep !== -1 && key.substring(sep + 1) === prefix) {
			toDelete.push(key);
		}
	});
	for(var i = 0; i < toDelete.length; i++) { cache.delete(toDelete[i]); }
};

function resolvePseudo(pseudoName, prefix, wiki) {
	var cache = getCache(wiki),
		key = cacheKey(pseudoName, prefix);
	if(cache && cache.has(key)) { return cache.get(key); }
	var fn = getRegistry()[pseudoName];
	if(!fn) { return undefined; }  // not a known pseudo — let caller leave segment as literal
	var result;
	try {
		result = fn(prefix, wiki);
	} catch(e) {
		console.error("namespace pseudo '" + pseudoName + "' threw:", e);
		result = null;
	}
	if(typeof result !== "string") { result = null; }
	if(cache) { cache.set(key, result); }
	return result;
}

/*
Expand every pseudo-segment (any segment starting with "_") in the ref
against its preceding prefix. Returns the expanded ref, or null if any
pseudo resolver returned null. Unknown _-prefixed segments are left
untouched (treated as literal — lets users have tiddlers legitimately
named `_something` without triggering the pipeline).
*/
exports.expandPseudoSegments = function(ref, wiki) {
	if(ref.indexOf("_") === -1) { return ref; }
	var segs = ref.split("/"),
		changed = false;
	for(var i = 0; i < segs.length; i++) {
		if(segs[i].charAt(0) !== "_") { continue; }
		var prefix = segs.slice(0, i).join("/"),
			replacement = resolvePseudo(segs[i], prefix, wiki);
		if(replacement === undefined) { continue; }  // unknown pseudo — leave as literal
		if(replacement === null) { return null; }    // known pseudo, couldn't resolve
		segs[i] = replacement;
		changed = true;
	}
	return changed ? segs.join("/") : ref;
};

/* ---------- main resolver ---------- */

/*
Resolve a reference.

ref:         the raw link target as the user typed it (e.g. "V3.3",
             "OWASP/ASVS/_latest/V3.3")
sourceTitle: title of the tiddler being rendered
wiki:        $tw.wiki (needs tiddlerExists, isShadowTiddler, each, eachShadow)
options:     optional; {context: "<prefix>"} to supply a declared context
             that shadows walk-up. Pseudo-segments in the context prefix
             are expanded before use.

Returns: {status, resolved, tried}
  status:   "literal" | "absolute" | "context" | "walkup" | "unresolved"
  resolved: resolved title or null
  tried:    ordered array of every title we checked (useful for tooltips)
*/
exports.resolve = function(ref, sourceTitle, wiki, options) {
	options = options || {};
	var tried = [];
	if(!ref) {
		return {status: "unresolved", resolved: null, tried: tried};
	}
	// 0. Expand pseudo-segments, if any.
	var expanded = exports.expandPseudoSegments(ref, wiki);
	if(expanded === null) {
		return {status: "unresolved", resolved: null, tried: [ref]};
	}
	// 1. Literal — always try first so $:/… and exact-title refs win.
	tried.push(expanded);
	if(exists(wiki, expanded)) {
		return {status: "literal", resolved: expanded, tried: tried};
	}
	// 2. Absolute (ref contains '/'): stop after the literal check — don't
	//    walk up. In current stages this branch is identical to #1; it
	//    becomes meaningful once mount points prepend a root prefix.
	if(expanded.indexOf("/") !== -1) {
		return {status: "unresolved", resolved: null, tried: tried};
	}
	// System-namespace refs never walk up or use context.
	if(expanded.indexOf("$:/") === 0) {
		return {status: "unresolved", resolved: null, tried: tried};
	}
	// 3. Context prefix — try "<context>/REF" when a declared context is
	//    present. Pseudo-segments in the context string expand too, so
	//    e.g. `\context OWASP/ASVS/_latest` drifts with the newest version.
	if(options.context) {
		var ctx = exports.expandPseudoSegments(options.context, wiki);
		if(ctx !== null && ctx !== "") {
			var ctxCandidate = ctx + "/" + expanded;
			tried.push(ctxCandidate);
			if(exists(wiki, ctxCandidate)) {
				return {status: "context", resolved: ctxCandidate, tried: tried};
			}
		}
	}
	// 4. Walk-up from the source tiddler's prefix.
	if(sourceTitle) {
		var segs = exports.splitPath(sourceTitle);
		// For $:/ titles the first segment is the "$:" marker; stop at i=2
		// so the shallowest prefix is "$:/<first-real-seg>" rather than
		// a bare "$:/REF".
		var minI = (segs[0] === "$:") ? 2 : 1;
		// Walk up to minI (inclusive). i = 0 would be the bare ref, already
		// tried as literal.
		for(var i = segs.length - 1; i >= minI; i--) {
			var candidate = segs.slice(0, i).join("/") + "/" + expanded;
			tried.push(candidate);
			if(exists(wiki, candidate)) {
				return {status: "walkup", resolved: candidate, tried: tried};
			}
		}
	}
	return {status: "unresolved", resolved: null, tried: tried};
};
