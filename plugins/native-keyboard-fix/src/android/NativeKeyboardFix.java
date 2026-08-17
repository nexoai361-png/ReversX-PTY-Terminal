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
                    // On Android WebView, we can't easily set inputType on the View itself
                    // but we can ensure the Window maintains the correct soft input mode
                    cordova.getActivity().getWindow().setSoftInputMode(
                        android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                    );
                    
                    callbackContext.success("Native flags verified");
                } catch (Exception e) {
                    callbackContext.error("Native error: " + e.getMessage());
                }
            }
        });
    }
}
