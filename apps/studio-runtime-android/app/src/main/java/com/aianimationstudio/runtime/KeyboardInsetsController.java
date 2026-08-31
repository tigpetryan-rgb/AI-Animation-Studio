package com.aianimationstudio.runtime;

import android.graphics.Insets;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.webkit.WebView;

final class KeyboardInsetsController {
    private KeyboardInsetsController() {}

    static void configureWindow(android.app.Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        } else {
            activity.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
    }

    @SuppressWarnings("deprecation")
    static void bind(FrameLayout root, WebView webView) {
        root.setOnApplyWindowInsetsListener((target, windowInsets) -> {
            int left;
            int top;
            int right;
            int bottom;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = windowInsets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                Insets ime = windowInsets.getInsets(WindowInsets.Type.ime());
                left = bars.left;
                top = bars.top;
                right = bars.right;
                bottom = Math.max(bars.bottom, ime.bottom);
            } else {
                left = windowInsets.getSystemWindowInsetLeft();
                top = windowInsets.getSystemWindowInsetTop();
                right = windowInsets.getSystemWindowInsetRight();
                bottom = windowInsets.getSystemWindowInsetBottom();
            }

            ViewGroup.LayoutParams raw = webView.getLayoutParams();
            FrameLayout.LayoutParams params = raw instanceof FrameLayout.LayoutParams
                    ? (FrameLayout.LayoutParams) raw
                    : new FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                    );

            if (
                    params.leftMargin != left
                    || params.topMargin != top
                    || params.rightMargin != right
                    || params.bottomMargin != bottom
            ) {
                params.setMargins(left, top, right, bottom);
                webView.setLayoutParams(params);
            }
            return windowInsets;
        });

        root.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(
                    View v,
                    int left,
                    int top,
                    int right,
                    int bottom,
                    int oldLeft,
                    int oldTop,
                    int oldRight,
                    int oldBottom
            ) {
                root.requestApplyInsets();
            }
        });
    }
}
