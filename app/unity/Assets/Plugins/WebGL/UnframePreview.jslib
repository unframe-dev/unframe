mergeInto(LibraryManager.library, {
  UnframePreviewPresenterMove: function (payload) {
    window.dispatchEvent(new CustomEvent('unframe-preview-presenter', {
      detail: JSON.parse(UTF8ToString(payload))
    }));
  },
  UnframePreviewInteraction: function (payload) {
    window.dispatchEvent(new CustomEvent('unframe-preview-interaction', {
      detail: JSON.parse(UTF8ToString(payload))
    }));
  },
  UnframePreviewNotify: function (payload) {
    window.dispatchEvent(new CustomEvent('unframe-preview', {
      detail: JSON.parse(UTF8ToString(payload))
    }));
  }
});
