mergeInto(LibraryManager.library, {
  UnframePreviewNotify: function (payload) {
    window.dispatchEvent(new CustomEvent('unframe-preview', {
      detail: JSON.parse(UTF8ToString(payload))
    }));
  }
});
