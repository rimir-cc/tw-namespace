/*\
title: $:/plugins/rimir/namespace/context-widget.js
type: application/javascript
module-type: widget

$context widget — sets the `ns-context` variable for its children.

Usage:

  <$context prefix="OWASP/ASVS/4.0.3">
    [[V3.3]] here resolves to OWASP/ASVS/4.0.3/V3.3
  </$context>

Used both directly by authors and as the target of the \context pragma
(which wraps the rest of the tiddler in a $context widget at parse time).

\*/

"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var ContextWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

ContextWidget.prototype = new Widget();

ContextWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	this.renderChildren(parent, nextSibling);
};

ContextWidget.prototype.execute = function() {
	var prefix = this.getAttribute("prefix", "");
	if(prefix) { this.setVariable("ns-context", prefix); }
	this.makeChildWidgets();
};

ContextWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(Object.keys(changedAttributes).length) {
		this.refreshSelf();
		return true;
	}
	return this.refreshChildren(changedTiddlers);
};

exports.context = ContextWidget;
