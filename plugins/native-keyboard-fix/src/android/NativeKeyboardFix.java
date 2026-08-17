package com.custom.keyboardfix;

import android.content.Context;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputConnectionWrapper;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;

import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.PluginResult;

import org.json.JSONArray;
import org.json.JSONException;

public class NativeKeyboardFix extends CordovaPlugin {

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if (action.equals("initialize")) {
            this.initialize(callbackContext);
            return true;
        } else if (action.equals("disableSuggestions")) {
            this.disableSuggestions(callbackContext);
            return true;
        }
        return false;
    }

    private void initialize(final CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(new Runnable() {
            public void run() {
                try {
                    // Force the window to adjust resize natively
                    cordova.getActivity().getWindow().setSoftInputMode(
                        android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE |
                        android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE
                    );
                    
                    callbackContext.success("Initialized Native Keyboard Fix");
                } catch (Exception e) {
                    callbackContext.error("Failed to initialize: " + e.getMessage());
                }
            }
        });
    }

    private void disableSuggestions(final CallbackContext callbackContext) {
        cordova.getActivity().runOnUiThread(new Runnable() {
            public void run() {
                try {
                    View view = webView.getView();
                    // Natively disable suggestions, auto-correct, and predictions
                    // TYPE_TEXT_VARIATION_VISIBLE_PASSWORD is a strong way to tell Android
                    // that we don't want any text assistance.
                    // TYPE_TEXT_FLAG_NO_SUGGESTIONS ensures dictionaries aren't used.
                    
                    int inputType = android.text.InputType.TYPE_CLASS_TEXT | 
                                    android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS |
                                    android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD;
                                    
                    // We try to set it on the webview itself
                    view.setInputType(inputType);
                    
                    callbackContext.success("Disabled Suggestions Natively");
                } catch (Exception e) {
                    callbackContext.error("Native error: " + e.getMessage());
                }
            }
        });
    }
}
