(function () {
  "use strict";

  function hasCep() {
    return !!window.__adobe_cep__;
  }

  function evalScript(script, callback) {
    if (!hasCep()) {
      callback("NO_CEP");
      return;
    }
    window.__adobe_cep__.evalScript(script, callback);
  }

  function getExtensionPath() {
    if (!hasCep()) {
      return "";
    }
    return window.__adobe_cep__.getSystemPath("extension");
  }

  function evalFile(path, callback) {
    var escaped = String(path).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    evalScript('$.evalFile("' + escaped + '")', callback || function () {});
  }

  window.SunoCueCEP = {
    hasCep: hasCep,
    evalScript: evalScript,
    getExtensionPath: getExtensionPath,
    evalFile: evalFile,
  };
})();

