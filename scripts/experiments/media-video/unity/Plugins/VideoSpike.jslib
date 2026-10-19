mergeInto(LibraryManager.library, {
  SpikeEvent: function (json) { window.spikeEvents.push(JSON.parse(UTF8ToString(json))); }
});
