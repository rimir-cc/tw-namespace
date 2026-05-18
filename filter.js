/*\
title: $:/plugins/rimir/namespace/filter.js
type: application/javascript
module-type: filteroperator

Filter operators exposing the namespace resolver.

Usage from wikitext:

  [<ref>ns-resolve<currentTiddler>]
    → resolved title, or the original ref if unresolved
      (so the enclosing $link widget still has a valid target).

  [<ref>ns-resolve-class<currentTiddler>]
    → "tc-tiddlylink ns-resolved"    when resolution succeeded
    → "tc-tiddlylink ns-unresolved"  when it did not

Both operators take the source tiddler title as their operand, so the caller
passes <currentTiddler>. The input is the reference string.

Context lookup — before calling the resolver we look up a declared
"context prefix":

  1. Widget variable `ns-context` (set by the <$context> widget or the
     \context pragma) — always active.
  2. Field `context` on the source tiddler — only when the
     "implicit-context" feature flag is enabled.

The context is passed as options.context to the resolver. Widget variable
wins over field so that nested <$context> widgets and \context pragmas
override the tiddler-level default.

\*/

"use strict";

var resolver     = require("$:/plugins/rimir/namespace/resolver.js");
var indexer      = require("$:/plugins/rimir/namespace/indexer.js");
var flags        = require("$:/plugins/rimir/namespace/featureflags.js");
var fieldAliases = require("$:/plugins/rimir/namespace/field-aliases.js");

function getContext(sourceTitle, options) {
	// Widget variable first (set by <$context> / \context pragma).
	/* istanbul ignore else — TW's filter pipeline always supplies a widget with getVariable */
	if(options.widget && typeof options.widget.getVariable === "function") {
		var v = options.widget.getVariable("ns-context");
		if(v) { return v; }
	}
	// Fallback: context field on the source tiddler.
	// Gated by the "implicit-context" feature flag.
	if(flags.isEnabled("implicit-context", options.wiki)) {
		if(sourceTitle && options.wiki) {
			var t = options.wiki.getTiddler(sourceTitle);
			if(t && t.fields && t.fields.context) { return t.fields.context; }
		}
	}
	return "";
}

exports["ns-resolve"] = function(source, operator, options) {
	var sourceTitle = operator.operand || "",
		context = getContext(sourceTitle, options),
		results = [];
	source(function(tiddler, title) {
		var r = resolver.resolve(title, sourceTitle, options.wiki, {context: context});
		results.push(r.resolved || title);
	});
	return results;
};

exports["ns-resolve-class"] = function(source, operator, options) {
	var sourceTitle = operator.operand || "",
		context = getContext(sourceTitle, options),
		results = [];
	source(function(tiddler, title) {
		var r = resolver.resolve(title, sourceTitle, options.wiki, {context: context});
		if(r.status === "out-of-scope") {
			// Vanilla TW link — no namespace styling. <$link> still adds its
			// own tc-tiddlylink-resolves / tc-tiddlylink-missing for existence.
			results.push("tc-tiddlylink");
		} else if(r.status === "ambiguous") {
			// Distinct class so themes can colour ambiguous separately from
			// missing/unresolved. Both ns-unresolved and ns-ambiguous apply.
			results.push("tc-tiddlylink ns-unresolved ns-ambiguous");
		} else if(r.status === "unresolved") {
			results.push("tc-tiddlylink ns-unresolved");
		} else if(r.status === "field-alias" && r.ambiguity) {
			// Locality narrowing picked a local target out of a wider
			// collision. The link works; the marker class hints at the
			// underlying ambiguity so users see they should still clean up.
			results.push("tc-tiddlylink ns-resolved ns-narrowed");
		} else {
			results.push("tc-tiddlylink ns-resolved");
		}
	});
	return results;
};

/*
[<ref>ns-resolve-diag<source>]
  → human-readable diagnostic string for a ref, or empty when there's
    nothing to say. Currently emits ambiguity messages (which tiddlers
    collide, which field, how to fix). Intended for the `title=` attribute
    on the rendered link so hover surfaces actionable info without
    cluttering the document text.
*/
exports["ns-resolve-diag"] = function(source, operator, options) {
	var sourceTitle = operator.operand || "",
		context = getContext(sourceTitle, options),
		results = [];
	source(function(tiddler, title) {
		var r = resolver.resolve(title, sourceTitle, options.wiki, {context: context});
		if(r.status === "ambiguous" && r.ambiguity) {
			var amb = r.ambiguity;
			var scopeNote = amb.subtree
				? " within \"" + amb.subtree + "\""
				: "";
			var lines = [
				"Ambiguous alias \"" + amb.token + "\"" + scopeNote +
				": defined on " + amb.candidates.length + " tiddlers."
			];
			for(var i = 0; i < amb.candidates.length; i++) {
				lines.push("  • " + amb.candidates[i]);
			}
			if(amb.allCandidates && amb.allCandidates.length > amb.candidates.length) {
				lines.push("");
				lines.push("Also declared outside this subtree (informational):");
				for(var j = 0; j < amb.allCandidates.length; j++) {
					if(amb.candidates.indexOf(amb.allCandidates[j]) === -1) {
						lines.push("  · " + amb.allCandidates[j]);
					}
				}
			}
			lines.push("");
			lines.push("To fix: remove \"" + amb.token + "\" from the \"" +
				amb.field + "\" field on all but one of these tiddlers.");
			results.push(lines.join("\n"));
		} else if(r.status === "field-alias" && r.ambiguity) {
			// Narrowed: a wider collision exists but locality picked one.
			// Tooltip lists where else the token lives so users notice.
			var nAmb = r.ambiguity;
			var others = [];
			for(var oi = 0; oi < nAmb.candidates.length; oi++) {
				if(nAmb.candidates[oi] !== nAmb.narrowedTo) {
					others.push(nAmb.candidates[oi]);
				}
			}
			var nLines = [
				"Resolved to \"" + nAmb.narrowedTo + "\" via subtree \"" +
				nAmb.subtree + "\"."
			];
			if(others.length) {
				nLines.push("");
				nLines.push("Also declared elsewhere — consider disambiguating:");
				for(var oj = 0; oj < others.length; oj++) {
					nLines.push("  · " + others[oj]);
				}
				nLines.push("");
				nLines.push("To clean up: remove \"" + nAmb.token + "\" from the \"" +
					nAmb.field + "\" field on the listed tiddlers.");
			}
			results.push(nLines.join("\n"));
		} else {
			results.push("");
		}
	});
	return results;
};

/*
[<title>ns-backlinks[]]
  → titles that reference `title` via any of literal, alias, mount,
    context, walk-up, pseudo-expanded, or transclusion. Sourced from
    the backlinks indexer — only accurate for indexable tiddlers
    (wikitext + markdown). Input titles are each looked up; outputs
    are union'd in sort order.
*/
exports["ns-backlinks"] = function(source, operator, options) {
	var results = {};
	source(function(tiddler, title) {
		var sources = indexer.getBacklinks(title);
		for(var i = 0; i < sources.length; i++) { results[sources[i]] = true; }
	});
	return Object.keys(results).sort();
};

/*
[ns-field-alias-ambiguities[]]
  → list of currently-ambiguous alias tokens (defined on two or more
    target tiddlers). Empty when no collisions exist. Source-independent;
    typical invocation is the bare `[ns-field-alias-ambiguities[]]`.
*/
exports["ns-field-alias-ambiguities"] = function(source, operator, options) {
	var ambs = fieldAliases.getAmbiguities(options.wiki);
	var tokens = [];
	for(var i = 0; i < ambs.length; i++) { tokens.push(ambs[i].token); }
	return tokens;
};

/*
[<token>ns-field-alias-candidates[]]
  → list of target tiddlers that all declare `<token>` in the configured
    alias field. Returns the single match when only one tiddler declares
    it (not ambiguous) so the operator is useful as both a diagnostic
    and a lookup primitive.
*/
exports["ns-field-alias-candidates"] = function(source, operator, options) {
	var results = {};
	source(function(tiddler, title) {
		var hit = fieldAliases.resolveFieldAlias(title, options.wiki);
		if(!hit) { return; }
		var candidates = hit.ambiguous ? hit.candidates : [hit.title];
		for(var i = 0; i < candidates.length; i++) { results[candidates[i]] = true; }
	});
	return Object.keys(results).sort();
};

/*
[<title>ns-forwardlinks[]]
  → titles that `title` references via the resolver. Diagnostic flip
    side of ns-backlinks.
*/
exports["ns-forwardlinks"] = function(source, operator, options) {
	var results = {};
	source(function(tiddler, title) {
		var targets = indexer.getForwardLinks(title);
		for(var i = 0; i < targets.length; i++) { results[targets[i]] = true; }
	});
	return Object.keys(results).sort();
};

/*
[<title>ns-pin-context[]]
  → title's body text with any `\context` pragma expanded (`_latest` and
    other pseudos resolved to current values). Non-destructive: returns
    the rewritten text; caller is responsible for persisting via
    $action-setfield. If no pragma or nothing to rewrite, returns the
    text unchanged.

    Typical use: <$button>
                   Pin _latest
                   <$action-setfield text={{{ [<currentTiddler>ns-pin-context[]] }}}/>
                 </$button>
*/
var RE_PRAGMA = /^(\s*\\context\s+)(\S+)(.*)$/m;
exports["ns-pin-context"] = function(source, operator, options) {
	var results = [];
	source(function(tiddler, title) {
		var t = options.wiki.getTiddler(title);
		/* istanbul ignore if — source callback guarantees tiddler is real */
		if(!t || !t.fields) { results.push(""); return; }
		var text = t.fields.text || /* istanbul ignore next — every fixture sets text */ "";
		var m = text.match(RE_PRAGMA);
		if(!m) { results.push(text); return; }
		var prefix = m[2],
			expanded = resolver.expandPseudoSegments(prefix, options.wiki);
		if(!expanded || expanded === prefix) { results.push(text); return; }
		results.push(text.substring(0, m.index) + m[1] + expanded + m[3] + text.substring(m.index + m[0].length));
	});
	return results;
};
