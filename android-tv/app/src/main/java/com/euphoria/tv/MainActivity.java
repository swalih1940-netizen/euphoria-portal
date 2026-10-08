package com.euphoria.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final String PREFS_NAME = "EuphoriaTVPrefs";
    private static final String KEY_PORTAL_URL = "portal_url";
    private static final String DEFAULT_SERVER_URL = "http://10.168.75.217:3001/tv";
    private static final String DEFAULT_LOCAL_URL = "http://10.168.75.217:3001/tv";
    private static final String DEFAULT_PRODUCTION_URL = "https://euphoria.sirajulirfan.com/tv";

    private WebView webView;
    private LinearLayout errorOverlay;
    private TextView txtErrorStatus;
    private TextView txtRetryCountdown;
    private TextView txtTargetUrl;
    private Button btnRetryNow;
    private Button btnOpenSettings;

    private SharedPreferences preferences;
    private String currentUrl;
    private boolean isErrorState = false;
    private CountDownTimer retryTimer;
    private long lastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep TV screen awake at all times (Kiosk mode)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_main);

        preferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String savedUrl = preferences.getString(KEY_PORTAL_URL, null);
        if (savedUrl == null || savedUrl.equals("https://euphoria.sirajulirfan.com/tv") || savedUrl.contains("192.168.1.100")) {
            currentUrl = DEFAULT_SERVER_URL;
            preferences.edit().putString(KEY_PORTAL_URL, DEFAULT_SERVER_URL).apply();
        } else {
            currentUrl = savedUrl;
        }

        initViews();
        setupWebView();
        hideSystemUI();

        loadPortalUrl(currentUrl);
    }

    private void initViews() {
        webView = findViewById(R.id.tvWebView);
        errorOverlay = findViewById(R.id.errorOverlay);
        txtErrorStatus = findViewById(R.id.txtErrorStatus);
        txtRetryCountdown = findViewById(R.id.txtRetryCountdown);
        txtTargetUrl = findViewById(R.id.txtTargetUrl);
        btnRetryNow = findViewById(R.id.btnRetryNow);
        btnOpenSettings = findViewById(R.id.btnOpenSettings);

        btnRetryNow.setOnClickListener(v -> retryConnection());
        btnOpenSettings.setOnClickListener(v -> showSettingsDialog());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();

        // Core HTML5 & Execution Settings
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Media & Audio Playback without User Interaction (for celebration sounds & fanfare)
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Viewport & Zoom Configuration
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);

        // Performance & Cache
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setVerticalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // Custom User Agent (Chrome TV / Desktop format to bypass mobile/bot blocks)
        String customUA = "Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 EuphoriaTV/1.0";
        settings.setUserAgentString(customUA);

        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript("(function() { return (document.body ? document.body.innerText : ''); })();", value -> {
                    if (value != null && value.contains("Cannot GET")) {
                        triggerErrorOverlay("Server Error: 404 (Cannot GET /tv at " + url + ")");
                    } else if (!isErrorState) {
                        showMainView();
                    }
                });
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                // Only show overlay if the main page failed to load
                if (request.isForMainFrame()) {
                    triggerErrorOverlay("Connection failed: " + error.getDescription());
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 400) {
                    triggerErrorOverlay("HTTP " + errorResponse.getStatusCode() + " Error on " + request.getUrl());
                }
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Allow self-signed or local certificates on LAN deployments
                handler.proceed();
            }
        });
    }

    private void loadPortalUrl(String url) {
        if (url == null || url.trim().isEmpty()) {
            url = DEFAULT_SERVER_URL;
        }
        currentUrl = url.trim();
        txtTargetUrl.setText("Target: " + currentUrl);
        isErrorState = false;
        webView.loadUrl(currentUrl);
    }

    private void triggerErrorOverlay(String reason) {
        isErrorState = true;
        runOnUiThread(() -> {
            webView.setVisibility(View.GONE);
            errorOverlay.setVisibility(View.VISIBLE);
            txtErrorStatus.setText(reason);
            startAutoRetryCountdown(8);
        });
    }

    private void showMainView() {
        isErrorState = false;
        if (retryTimer != null) {
            retryTimer.cancel();
        }
        runOnUiThread(() -> {
            errorOverlay.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
        });
    }

    private void startAutoRetryCountdown(int seconds) {
        if (retryTimer != null) {
            retryTimer.cancel();
        }

        retryTimer = new CountDownTimer(seconds * 1000L, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                long sec = millisUntilFinished / 1000;
                txtRetryCountdown.setText(String.format("Automatic reconnect in %d seconds...", sec));
            }

            @Override
            public void onFinish() {
                retryConnection();
            }
        };
        retryTimer.start();
    }

    private void retryConnection() {
        if (retryTimer != null) {
            retryTimer.cancel();
        }
        txtRetryCountdown.setText("Re-establishing connection...");
        isErrorState = false;
        webView.reload();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (isErrorState) {
                startAutoRetryCountdown(10);
            }
        }, 4000);
    }

    public void showSettingsDialog() {
        if (retryTimer != null) {
            retryTimer.cancel();
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        LayoutInflater inflater = getLayoutInflater();
        View dialogView = inflater.inflate(R.layout.dialog_settings, null);
        builder.setView(dialogView);

        AlertDialog dialog = builder.create();

        EditText editUrl = dialogView.findViewById(R.id.editPortalUrl);
        Button btnPresetCloud = dialogView.findViewById(R.id.btnPresetCloud);
        Button btnPresetLocal = dialogView.findViewById(R.id.btnPresetLocal);
        Button btnClearCache = dialogView.findViewById(R.id.btnClearCache);
        Button btnCancel = dialogView.findViewById(R.id.btnCancel);
        Button btnSave = dialogView.findViewById(R.id.btnSave);

        editUrl.setText(currentUrl);

        btnPresetCloud.setOnClickListener(v -> editUrl.setText(DEFAULT_PRODUCTION_URL));
        btnPresetLocal.setOnClickListener(v -> editUrl.setText(DEFAULT_LOCAL_URL));

        btnClearCache.setOnClickListener(v -> {
            webView.clearCache(true);
            Toast.makeText(this, "WebView cache cleared", Toast.LENGTH_SHORT).show();
        });

        btnCancel.setOnClickListener(v -> dialog.dismiss());

        btnSave.setOnClickListener(v -> {
            String newUrl = editUrl.getText().toString().trim();
            if (!newUrl.isEmpty()) {
                preferences.edit().putString(KEY_PORTAL_URL, newUrl).apply();
                dialog.dismiss();
                loadPortalUrl(newUrl);
            } else {
                Toast.makeText(this, "Please enter a valid URL", Toast.LENGTH_SHORT).show();
            }
        });

        dialog.show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // TV Remote Navigation and Shortcuts
        switch (keyCode) {
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_SETTINGS:
            case KeyEvent.KEYCODE_INFO:
                showSettingsDialog();
                return true;

            case KeyEvent.KEYCODE_REFRESH:
                webView.reload();
                Toast.makeText(this, "Refreshing display...", Toast.LENGTH_SHORT).show();
                return true;

            case KeyEvent.KEYCODE_BACK:
                long currentTime = System.currentTimeMillis();
                if (event.isLongPress()) {
                    showSettingsDialog();
                    return true;
                }
                // Double-click back button within 2 seconds to prompt exit
                if (currentTime - lastBackPressTime < 2000) {
                    finish();
                } else {
                    lastBackPressTime = currentTime;
                    Toast.makeText(this, "Press BACK again to exit or MENU for settings", Toast.LENGTH_SHORT).show();
                }
                return true;
        }

        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUI();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    private void hideSystemUI() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }
}
