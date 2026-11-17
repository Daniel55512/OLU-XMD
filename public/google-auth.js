"use strict";

(() => {
    const googleButton = document.getElementById("googleSignInButton");
    const extra = document.getElementById("googleAuthExtra");
    const message = document.getElementById("message");

    if (!googleButton || !extra || !message) return;

    let googleScriptPromise = null;
    let busy = false;

    function setMessage(text, type = "info") {
        message.textContent = text;
        message.dataset.kind = type;
    }

    async function loadGoogleScript() {
        if (window.google?.accounts?.id) return;

        if (googleScriptPromise) {
            return googleScriptPromise;
        }

        googleScriptPromise = new Promise((resolve, reject) => {
            let script = document.querySelector(
                'script[data-olu-google-identity]'
            );

            if (!script) {
                script = document.createElement("script");
                script.src = "https://accounts.google.com/gsi/client";
                script.async = true;
                script.defer = true;
                script.dataset.oluGoogleIdentity = "true";
            }

            script.onload = () => {
                if (window.google?.accounts?.id) resolve();
                else reject(new Error("Google Sign-In could not load."));
            };

            script.onerror = () => {
                googleScriptPromise = null;
                reject(new Error("Unable to load Google's sign-in service."));
            };

            if (script.parentNode) {
                if (window.google?.accounts?.id) resolve();
                else script.addEventListener("load", resolve, { once: true });
            } else {
                document.head.appendChild(script);
            }
        });

        return googleScriptPromise;
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options
        });

        const result = await response.json().catch(() => ({}));

        return { response, result };
    }

    function showRetry(messageText) {
        extra.innerHTML = `
            <div class="google-step">
                <p class="google-step-message" role="status"></p>
                <button type="button" class="auth-secondary" id="googleRetryButton">
                    Try Google Sign-In Again
                </button>
            </div>
        `;

        extra.querySelector(".google-step-message").textContent =
            messageText;

        document.getElementById("googleRetryButton")
            .addEventListener("click", startGoogleSignIn);
    }

    function showCountryStep() {
        extra.innerHTML = `
            <div class="google-step">
                <h3>Choose Your Country</h3>
                <p>Your country determines your account currency and regional pricing.</p>

                <label for="googleCountryCode">Country</label>
                <select id="googleCountryCode" required>
                    <option value="">Select your country</option>
                    <option value="NG">Nigeria</option>
                    <option value="GH">Ghana</option>
                    <option value="ZA">South Africa</option>
                    <option value="US">United States</option>
                </select>

                <button type="button" class="auth-submit" id="googleCompleteButton">
                    Complete Registration
                </button>

                <p class="google-step-message" id="googleStepMessage"
                   role="status" aria-live="polite"></p>

                <button type="button" class="auth-secondary"
                        id="googleRestartButton">
                    Use Another Google Account
                </button>
            </div>
        `;

        document.getElementById("googleCompleteButton")
            .addEventListener("click", completeGoogleRegistration);

        document.getElementById("googleRestartButton")
            .addEventListener("click", startGoogleSignIn);
    }

    function showExistingAccountStep() {
        extra.innerHTML = `
            <div class="google-step">
                <h3>Link Your Existing Account</h3>
                <p>An OLU-XMD account already exists with this Google email.
                   Enter your existing OLU-XMD password once to link it securely.</p>

                <label for="googleLinkPassword">Existing OLU-XMD Password</label>
                <input
                    type="password"
                    id="googleLinkPassword"
                    autocomplete="current-password"
                    placeholder="Enter your OLU-XMD password"
                    required
                >

                <button type="button" class="auth-submit" id="googleLinkButton">
                    Verify Password and Link Google
                </button>

                <p class="google-step-message" id="googleStepMessage"
                   role="status" aria-live="polite"></p>

                <button type="button" class="auth-secondary"
                        id="googleRestartButton">
                    Use Another Google Account
                </button>
            </div>
        `;

        document.getElementById("googleLinkButton")
            .addEventListener("click", linkExistingAccount);

        document.getElementById("googleRestartButton")
            .addEventListener("click", startGoogleSignIn);
    }

    async function completeGoogleRegistration() {
        const countryCode =
            document.getElementById("googleCountryCode").value;

        const button =
            document.getElementById("googleCompleteButton");

        const stepMessage =
            document.getElementById("googleStepMessage");

        if (!countryCode) {
            stepMessage.textContent = "Please select your country.";
            return;
        }

        if (busy) return;
        busy = true;
        button.disabled = true;
        button.textContent = "Creating Account...";

        try {
            const { response, result } = await requestJson(
                "/api/auth/google/complete",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ countryCode })
                }
            );

            if (response.ok && result.success) {
                setMessage("Account created. Opening your dashboard...");
                window.location.href = "/dashboard.html";
                return;
            }

            if (result.code === "GOOGLE_PENDING_EXPIRED") {
                showRetry(result.message);
                return;
            }

            stepMessage.textContent =
                result.message || "Unable to complete registration.";

        } catch (error) {
            stepMessage.textContent =
                "Unable to connect to the server. Please try again.";
        } finally {
            busy = false;
            if (button.isConnected) {
                button.disabled = false;
                button.textContent = "Complete Registration";
            }
        }
    }

    async function linkExistingAccount() {
        const passwordInput =
            document.getElementById("googleLinkPassword");

        const password = passwordInput.value;

        const button =
            document.getElementById("googleLinkButton");

        const stepMessage =
            document.getElementById("googleStepMessage");

        if (!password) {
            stepMessage.textContent =
                "Enter your existing OLU-XMD password.";
            return;
        }

        if (busy) return;
        busy = true;
        button.disabled = true;
        button.textContent = "Verifying...";

        try {
            const { response, result } = await requestJson(
                "/api/auth/google/link",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ password })
                }
            );

            if (response.ok && result.success) {
                setMessage("Account linked. Opening your dashboard...");
                window.location.href = "/dashboard.html";
                return;
            }

            if (result.code === "GOOGLE_PENDING_EXPIRED") {
                showRetry(result.message);
                return;
            }

            stepMessage.textContent =
                result.message || "Unable to link your account.";

        } catch (error) {
            stepMessage.textContent =
                "Unable to connect to the server. Please try again.";
        } finally {
            busy = false;
            if (button.isConnected) {
                button.disabled = false;
                button.textContent = "Verify Password and Link Google";
            }
        }
    }

    async function handleGoogleCredential(response) {
        if (busy) return;
        busy = true;

        googleButton.setAttribute("aria-busy", "true");
        setMessage("Verifying your Google account...");

        try {
            const { response: apiResponse, result } = await requestJson(
                "/api/auth/google",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        credential: response.credential
                    })
                }
            );

            if (apiResponse.ok && result.success) {
                setMessage("Google sign-in successful. Opening dashboard...");
                window.location.href = "/dashboard.html";
                return;
            }

            if (result.code === "COUNTRY_REQUIRED") {
                showCountryStep();
                setMessage("Google verified. Choose your country to continue.");
                return;
            }

            if (result.code === "ACCOUNT_LINK_REQUIRED") {
                showExistingAccountStep();
                setMessage("Google verified. Confirm your existing account password.");
                return;
            }

            showRetry(result.message || "Google sign-in failed. Please try again.");

        } catch (error) {
            showRetry(error.message || "Unable to contact the server.");
        } finally {
            busy = false;
            googleButton.removeAttribute("aria-busy");
        }
    }

    async function startGoogleSignIn() {
        if (busy) return;

        busy = true;
        extra.innerHTML = "";
        googleButton.innerHTML = "Preparing Google Sign-In...";
        setMessage("Connecting to Google...");

        try {
            const { response, result } = await requestJson(
                "/api/auth/google/nonce"
            );

            if (!response.ok || !result.success) {
                throw new Error(
                    result.message || "Google sign-in is not available."
                );
            }

            await loadGoogleScript();

            if (!window.google?.accounts?.id) {
                throw new Error("Google Sign-In did not initialize.");
            }

            googleButton.innerHTML = "";

            window.google.accounts.id.initialize({
                client_id: result.clientId,
                nonce: result.nonce,
                callback: handleGoogleCredential,
                auto_select: false
            });

            window.google.accounts.id.renderButton(
                googleButton,
                {
                    type: "standard",
                    theme: "outline",
                    size: "large",
                    text: "continue_with",
                    shape: "rectangular",
                    width: Math.min(
                        400,
                        Math.max(240, googleButton.clientWidth || 320)
                    ),
                    logo_alignment: "left"
                }
            );

            setMessage("Choose your Google account to continue.");

        } catch (error) {
            googleButton.innerHTML = "";
            showRetry(error.message || "Google sign-in could not load.");
            setMessage("Google sign-in is currently unavailable.", "error");
        } finally {
            busy = false;
        }
    }

    startGoogleSignIn();
})();
