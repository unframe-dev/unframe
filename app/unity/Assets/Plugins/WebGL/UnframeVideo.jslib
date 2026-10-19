mergeInto(LibraryManager.library, {
  $unframeVideos: {},
  UnframeVideoCreateUrl__deps: ['$unframeVideos', '$stringToNewUTF8'],
  UnframeVideoCreateUrl: function (bytes, length) {
    var url = URL.createObjectURL(new Blob([HEAPU8.slice(bytes, bytes + length)], {type: 'video/mp4'}));
    unframeVideos[url] = {status: 0, video: null, requested: false};
    window.unframeVideoActivate = function () {
      return Promise.all(Object.keys(unframeVideos).map(function (key) {
        var entry = unframeVideos[key];
        if (!entry.video) return Promise.resolve(true);
        entry.status = 0; entry.video.muted = false;
        return Promise.resolve(entry.originalPlay()).then(function () {
          entry.status = 1;
          if (!entry.requested) entry.video.pause();
          return true;
        }, function () { entry.status = 2; return false; });
      }));
    };
    return stringToNewUTF8(url);
  },
  UnframeVideoObserve__deps: ['$unframeVideos', '$videoInstances'],
  UnframeVideoObserve: function (ptr) {
    var url = UTF8ToString(ptr), entry = unframeVideos[url];
    if (!entry) return;
    Object.keys(videoInstances).forEach(function (id) {
      var video = videoInstances[id];
      if (video.src !== url || entry.video) return;
      entry.video = video;
      var play = video.play.bind(video); entry.originalPlay = play;
      video.play = function () {
        var result = play();
        if (result) result.then(function () { if (entry.status !== 2) entry.status = 1; }, function () { entry.status = 2; });
        return result;
      };
    });
  },
  UnframeVideoSetRequested__deps: ['$unframeVideos'],
  UnframeVideoSetRequested: function (ptr, playing) { var entry = unframeVideos[UTF8ToString(ptr)]; if (entry) entry.requested = !!playing; },
  UnframeVideoPlayStatus__deps: ['$unframeVideos'],
  UnframeVideoPlayStatus: function (ptr) { var entry = unframeVideos[UTF8ToString(ptr)]; return entry ? entry.status : 2; },
  UnframeVideoRevokeUrl__deps: ['$unframeVideos'],
  UnframeVideoRevokeUrl: function (ptr) { var url = UTF8ToString(ptr); delete unframeVideos[url]; URL.revokeObjectURL(url); }
});
