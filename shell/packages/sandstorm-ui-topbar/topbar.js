// Sandstorm - Personal Cloud Sandbox
// Copyright (c) 2015 Sandstorm Development Group, Inc. and contributors
// All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var reloadBlockingCount = 0;
var blockedReload = new ReactiveVar(null);
var explicitlyUnblocked = false;
Reload._onMigrate(undefined, function (retry) {
  if (reloadBlockingCount > 0 && !explicitlyUnblocked) {
    console.log("New version ready, but blocking reload because an app is open.");
    blockedReload.set(retry);
    return false;
  } else {
    return [true];
  }
});

function unblockUpdate() {
  var retry = blockedReload.get();
  if (retry) {
    blockedReload.set(null);
    explicitlyUnblocked = true;
    retry();
  }
}

Template.sandstormTopbarBlockReload.onCreated(function () { ++reloadBlockingCount; });
Template.sandstormTopbarBlockReload.onDestroyed(function () {
  if (--reloadBlockingCount == 0) {
    unblockUpdate();
  }
});

Template.sandstormTopbar.onCreated(function () {
  Template.instance().popupPosition = new ReactiveVar(undefined, _.isEqual);
});

Template.sandstormTopbar.helpers({
  isUpdateBlocked: function () {
    return !!blockedReload.get();
  },

  items: function () {
    this._itemsTracker.depend();

    // Note that JS objects always iterate in the order in which keys were added, so this actually
    // produces a stable ordering.
    return _.sortBy(_.values(this._items), function (item) { return -(item.priority || 0); });
  },

  currentPopup: function () {
    var name = this._expanded.get();
    if (name) {
      return this._items[name];
    } else {
      return null;
    }
  },

  template: function () {
    // Spacebars' {{>foo bar}} passes `bar` by pushing it onto the data context stack rather than
    // passing it as a parameter. The original data context must be accessed via `parentData()`.
    var item = Template.parentData(1);
    return item.template;
  },

  popupTemplate: function () {
    // Here we need parentData(2) because we've also pushed `position` onto the stack.
    var item = Template.parentData(2);
    return item.popupTemplate;
  },

  position: function () {
    var instance = Template.instance();
    var item = instance.data._items[instance.data._expanded.get()];
    if (item) {
      Meteor.defer(function () {
        var element = instance.find(".topbar>." + item.name);
        if (element) {
          // This positions the popup under the topbar item that spawned it. As a hacky heuristic,
          // we position the popup from the left if the item is closer to the left of the window,
          // or from the right otherwise.
          //
          // TODO(someday): Make this better. We could wait until the popup template has opened and
          //   rendered, then choose a better position based on its full size.

          var rect = element.getBoundingClientRect();
          var currentWindowWidth = windowWidth.get();
          var windowMid = currentWindowWidth / 2;
          var itemMid = (rect.left + rect.right) / 2;
          instance.popupPosition.set(itemMid < windowMid
              ? { align: "left", px: Math.max(itemMid - 50, 0) }
              : { align: "right", px: Math.max(currentWindowWidth - itemMid - 50, 0) });
        }
      });
    }

    return instance.popupPosition.get()
        || { align: "left", px: 0 };
  },
});

var windowWidth = new ReactiveVar(window.innerWidth);
window.addEventListener("resize", function () {
  windowWidth.set(window.innerWidth);
});

Template.sandstormTopbar.events({
  "click .topbar-update": function (event) {
    unblockUpdate();
  },

  "click .topbar>li": function (event) {
    var data = Blaze.getData(event.currentTarget);
    if (data.popupTemplate) {
      event.stopPropagation();
      event.preventDefault();

      var topbar = Template.instance().data;
      topbar._expanded.set(data.name);
      topbar._menuExpanded.set(false);
    }
  },

  "click .popup": function (event) {
    // Clicked outside the popup; close it.
    event.stopPropagation();
    Template.instance().data.closePopup();
  },

  "click .popup>.frame>.close-popup": function (event) {
    event.stopPropagation();
    Template.instance().data.closePopup();
  },

  "click .popup>.frame": function (event) {
    event.stopPropagation();  // don't propagate to closer
  },

  "click .menu-button": function (event) {
    this._menuExpanded.set(!this._menuExpanded.get());
  }
});

Template.sandstormTopbarItem.onCreated(function () {
  var item = _.clone(this.data);
  var topbar = item.topbar;
  delete item.topbar;

  if (typeof item.template === "string") {
    item.template = Template[item.template];
  }
  if (typeof item.popupTemplate === "string") {
    item.popupTemplate = Template[item.popupTemplate];
  }

  var instance = Template.instance();

  // Support inline definitions using {{#sandstormTopbarItem}}.
  var view = instance.view;
  if (!item.template && view.templateContentBlock) {
    item.template = view.templateContentBlock;
  }
  if (!item.popupTemplate && view.templateElseBlock) {
    item.popupTemplate = view.templateElseBlock;
  }

  if ("data" in item) {
    // TODO(someday): Verify that the template is recreated if the input data changes, or
    //   otherwise force this ReactiveVar to update whenever the data changes.
    item.data = new ReactiveVar(item.data);
  } else {
    // TODO(someday): We really want to pull the whole data *stack*, but I don't know how.
    var dataVar = new ReactiveVar(Template.parentData(1), _.isEqual);
    instance.autorun(function () {
      dataVar.set(Template.parentData(1));
    });
    item.data = dataVar;
  }

  instance.topbarCloser = topbar.addItem(item);
});

Template.sandstormTopbarItem.onDestroyed(function () {
  Template.instance().topbarCloser.close();
});

// =======================================================================================
// Public interface

SandstormTopbar = function (expandedVar) {
  // `expandedVar` is an optional object that behaves like a `ReactiveVar` and will be used to
  // track which popup is currently open. (The caller may wish to back this with a Session
  // variable.)

  this._items = {};
  this._itemsTracker = new Tracker.Dependency();

  this._expanded = expandedVar || new ReactiveVar(null);
  this._menuExpanded = new ReactiveVar(false);
}

SandstormTopbar.prototype.reset = function () {
  this._menuExpanded.set(false);
  this._expanded.set(null);
}

SandstormTopbar.prototype.closePopup = function () {
  var name = this._expanded.get();
  if (!name) return;

  var item = this._items[name];
  if (item.onDismiss) {
    var result = item.onDismiss();
    if (typeof result === "string") {
      if (result === "block") {
        return;
      } else if (result === "remove") {
        delete this._items[item.name];
        this._itemsTracker.changed();
      } else {
        throw new Error("Topbar item onDismiss handler returned bogus result:", result);
      }
    }
  }

  this._expanded.set(null);
}

SandstormTopbar.prototype.addItem = function (item) {
  // Adds a new item to the top bar, such as a button or a menu.
  //
  // Returns an object with a close() method which may be called to unregister the item.

  check(item, {
    name: String,
    // CSS class name of this item. Must be unique.

    template: Template,
    // Template for the item content as rendered in the topbar.

    popupTemplate: Match.Optional(Template),
    // If a popup box should appear when the item is clicked, this is the template for the content
    // of that box.

    data: Match.Optional(ReactiveVar),
    // Data context for `template` and `popupTempelate`.

    startOpen: Match.Optional(Boolean),
    // If true, this item's popup should start out open.

    priority: Match.Optional(Number),
    // Specifies ordering of items. Higher-priority items will be at the top of the list. Items
    // with the same priority are sorted in the order in which addItem() was called. The default
    // priority is zero.
    //
    // Note that Sandstorm's stylesheet makes some items float: right. Of the items floating
    // right, the highest-priority will be *rightmost*. Essentially, higher-priority items tend
    // towards the outsides of the top bar with lower-priority items going inside of them.

    onDismiss: Match.Optional(Function),
    // Specifies a function to call when the popup is dismissed by clicking outside of the popup
    // space. This function may return some special string values with specific meanings:
    // * "remove": Removes the topbar item, like if close() were called on the result of addItem().
    // * "block": Block the attempt to dismiss the popup.
  });

  if (!item.popupTemplate && (item.startOpen || item.onDismiss)) {
    throw new Error("can't set startOpen or onDismiss without setting popupTemplate");
  }

  if (item.name in this._items) {
    throw new Error("duplicate top bar item name:", item.name);
  }

  this._items[item.name] = item;
  this._itemsTracker.changed();

  if (item.startOpen) {
    this._expanded.set(item.name);
  }

  var self = this;
  return {
    close: function() {
      if (self._items[item.name] === item) {
        if (self._expanded.get() === item.name) {
          self._expanded.set(null);
        }

        delete self._items[item.name];
        self._itemsTracker.changed();
      }
    }
  };
};
