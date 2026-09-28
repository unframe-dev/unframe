mergeInto(LibraryManager.library, {
  PostPreviewMessage: function (jsonPointer) {
    try {
      window.parent.postMessage(JSON.parse(UTF8ToString(jsonPointer)), window.location.origin);
    } catch (error) {
      console.error('Preview message failed', error);
    }
  }
});
