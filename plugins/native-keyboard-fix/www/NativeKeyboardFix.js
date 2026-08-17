var exec = require('cordova/exec');

exports.initialize = function (success, error) {
    exec(success, error, 'NativeKeyboardFix', 'initialize', []);
};

exports.disableSuggestions = function (success, error) {
    exec(success, error, 'NativeKeyboardFix', 'disableSuggestions', []);
};
