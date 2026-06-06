var SunoCueHost = SunoCueHost || {};

(function () {
  function quote(value) {
    return '"' + String(value === undefined || value === null ? "" : value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
  }

  function jsonObject(fields) {
    var parts = [];
    for (var key in fields) {
      if (fields.hasOwnProperty(key)) {
        if (typeof fields[key] === "number") {
          parts.push(quote(key) + ":" + fields[key]);
        } else if (fields[key] instanceof Array) {
          parts.push(quote(key) + ":[" + fields[key].join(",") + "]");
        } else {
          parts.push(quote(key) + ":" + quote(fields[key]));
        }
      }
    }
    return "{" + parts.join(",") + "}";
  }

  function timeToSeconds(timeValue) {
    if (!timeValue && timeValue !== 0) {
      return 0;
    }
    if (typeof timeValue === "number") {
      return timeValue;
    }
    if (timeValue.seconds !== undefined) {
      return Number(timeValue.seconds);
    }
    return Number(timeValue) || 0;
  }

  function safeCall(label, fn, fallback) {
    try {
      return fn();
    } catch (error) {
      return fallback;
    }
  }

  function secondsToDisplay(seconds) {
    seconds = Number(seconds) || 0;
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var wholeSeconds = Math.floor(seconds % 60);
    var millis = Math.round((seconds - Math.floor(seconds)) * 1000);
    return pad(hours, 2) + ":" + pad(minutes, 2) + ":" + pad(wholeSeconds, 2) + "." + pad(millis, 3);
  }

  function pad(value, length) {
    var text = String(value);
    while (text.length < length) {
      text = "0" + text;
    }
    return text;
  }

  function getInOut(sequence) {
    var inTime = safeCall("in", function () {
      return sequence.getInPointAsTime ? sequence.getInPointAsTime() : sequence.getInPoint();
    }, 0);
    var outTime = safeCall("out", function () {
      return sequence.getOutPointAsTime ? sequence.getOutPointAsTime() : sequence.getOutPoint();
    }, 0);
    var inSeconds = timeToSeconds(inTime);
    var outSeconds = timeToSeconds(outTime);

    if (outSeconds <= inSeconds) {
      outSeconds = timeToSeconds(sequence.end);
    }

    return {
      inSeconds: inSeconds,
      outSeconds: outSeconds,
    };
  }

  function markerToJson(marker) {
    var startSeconds = timeToSeconds(marker.start);
    var endSeconds = marker.end ? timeToSeconds(marker.end) : startSeconds;
    return jsonObject({
      absoluteTime: secondsToDisplay(startSeconds),
      startSeconds: startSeconds,
      endSeconds: endSeconds,
      name: marker.name || "",
      comments: marker.comments || "",
      type: marker.type || "Comment",
    });
  }

  SunoCueHost.getActiveSequenceCue = function () {
    try {
      if (!app.project || !app.project.activeSequence) {
        return jsonObject({ error: "Open a sequence first." });
      }

      var sequence = app.project.activeSequence;
      var range = getInOut(sequence);
      var markers = [];
      var markerCollection = sequence.markers;
      var markerError = "";
      var markerCount = markerCollection && markerCollection.numMarkers !== undefined ? markerCollection.numMarkers : -1;

      try {
        var marker = markerCollection ? markerCollection.getFirstMarker() : null;
        var safety = 0;
        while (marker && safety < 1000) {
          markers.push(markerToJson(marker));
          marker = markerCollection.getNextMarker(marker);
          safety++;
        }
      } catch (markerLoopError) {
        markerError = markerLoopError && markerLoopError.message ? markerLoopError.message : String(markerLoopError);
      }

      var diagnostics = "Sequence read: " + (sequence.name || "(unnamed)") +
        " | raw markers: " + markerCount +
        " | returned markers: " + markers.length +
        " | in/out: " + secondsToDisplay(range.inSeconds) + " - " + secondsToDisplay(range.outSeconds);
      if (markerError) {
        diagnostics += " | marker error: " + markerError;
      }

      return jsonObject({
        sequenceName: sequence.name || "",
        inTime: secondsToDisplay(range.inSeconds),
        outTime: secondsToDisplay(range.outSeconds),
        inSeconds: range.inSeconds,
        outSeconds: range.outSeconds,
        markers: markers,
        diagnostics: diagnostics,
      });
    } catch (error) {
      return jsonObject({ error: error && error.message ? error.message : String(error) });
    }
  };
})();
