﻿/// <reference path="vaultbridge.js" />
/// file: vaultbridge.js

var vaultui = (function () {

    /**
    * @param {string} type
    * @param {string} txt
    * @param {string} category
    * @param {string} id
    */
    function VaultFeedback(type, txt, category, id) {
        var self = this;
        this.type = type;
        this.txt = txt;
        this.category = category;
        this.id = id;
        /**
        * @param {string} str
        * @param {string} by
        */
        this.replace = function (str, by) {
            return new VaultFeedback(self.type, self.txt.replace(str, by), self.category, self.id);
        };
    }

    var VaultFeedbacks = {
        vaultLoading: new VaultFeedback("?", "Checking BTCPayServer Vault is running...", "vault-feedback1", "vault-loading"),
        vaultDenied: new VaultFeedback("failed", "The user declined access to the vault.", "vault-feedback1", "vault-denied"),
        vaultGranted: new VaultFeedback("ok", "Access to vault granted by owner.", "vault-feedback1", "vault-granted"),
        noVault: new VaultFeedback("failed", "BTCPayServer Vault does not seems running, you can download it on <a target=\"_blank\" href=\"https://github.com/btcpayserver/BTCPayServer.Vault/releases/latest\">Github</a>.", "vault-feedback1", "no-vault"),
        noWebsockets: new VaultFeedback("failed", "Web sockets are not supported by the browser.", "vault-feedback1", "no-websocket"),
        errorWebsockets: new VaultFeedback("failed", "Error of the websocket while connecting to the backend.", "vault-feedback1", "error-websocket"),
        bridgeConnected: new VaultFeedback("ok", "BTCPayServer successfully connected to the vault.", "vault-feedback1", "bridge-connected"),
        noDevice: new VaultFeedback("failed", "No device connected.", "vault-feedback2", "no-device"),
        fetchingDevice: new VaultFeedback("?", "Fetching device...", "vault-feedback2", "fetching-device"),
        deviceFound: new VaultFeedback("ok", "Device found: {{0}}", "vault-feedback2", "device-selected"),
        fetchingXpubs: new VaultFeedback("?", "Fetching public keys...", "vault-feedback3", "fetching-xpubs"),
        fetchedXpubs: new VaultFeedback("ok", "Public keys successfully fetched.", "vault-feedback3", "xpubs-fetched"),
        unexpectedError: new VaultFeedback("failed", "An unexpected error happened.", "vault-feedback3", "unknown-error"),
        needPin: new VaultFeedback("?", "Enter the pin.", "vault-feedback3", "need-pin"),
        incorrectPin: new VaultFeedback("failed", "Incorrect pin code.", "vault-feedback3", "incorrect-pin"),
        invalidPasswordConfirmation: new VaultFeedback("failed", "Invalid password confirmation.", "vault-feedback3", "invalid-password-confirm"),
        wrongWallet: new VaultFeedback("failed", "This device can't sign the transaction.", "vault-feedback3", "wrong-wallet"),
        needPassphrase: new VaultFeedback("?", "Enter the passphrase.", "vault-feedback3", "need-passphrase"),
        signingTransaction: new VaultFeedback("?", "Signing the transaction...", "vault-feedback3", "ask-signing"),
        signingRejected: new VaultFeedback("failed", "The user refused to sign the transaction", "vault-feedback3", "user-reject"),
    };

    /**
     * @param {string} backend_uri
     */
    function VaultBridgeUI(backend_uri) {
        /**
        * @type {VaultBridgeUI}
        */
        var self = this;
        this.backend_uri = backend_uri;
        /**
        * @type {vault.VaultBridge}
        */
        this.bridge = null;

        /**
        * @type {string}
        */
        this.psbt = null;

        this.xpubs = null;
        /**
        * @param {VaultFeedback} feedback
        */
        function show(feedback) {
            var icon = $(".vault-feedback." + feedback.category + " " + ".vault-feedback-icon");
            icon.removeClass();
            icon.addClass("vault-feedback-icon");
            if (feedback.type == "?") {
                icon.addClass("fa fa-question-circle feedback-icon-loading");
            }
            else if (feedback.type == "ok") {
                icon.addClass("fa fa-check-circle feedback-icon-success");
            }
            else if (feedback.type == "failed") {
                icon.addClass("fa fa-times-circle feedback-icon-failed");
            }
            var content = $(".vault-feedback." + feedback.category + " " + ".vault-feedback-content");
            content.html(feedback.txt);
        }
        function showError(json) {
            if (json.hasOwnProperty("error")) {
                for (var key in VaultFeedbacks) {
                    if (VaultFeedbacks.hasOwnProperty(key) && VaultFeedbacks[key].id == json.error) {
                        show(VaultFeedbacks[key]);
                        if (json.hasOwnProperty("details"))
                            console.warn(json.details);
                        return;
                    }
                }
                show(VaultFeedbacks.unexpectedError);
                if (json.hasOwnProperty("details"))
                    console.warn(json.details);
            }
        }
        async function needRetry(json) {
            if (json.hasOwnProperty("error")) {
                var handled = false;
                if (json.error === "need-device") {
                    handled = true;
                    if (await self.askForDevice())
                        return true;
                }
                if (json.error === "need-pin") {
                    handled = true;
                    if (await self.askForPin())
                        return true;
                }
                if (json.error === "need-passphrase") {
                    handled = true;
                    if (await self.askForPassphrase())
                        return true;
                }
                if (!handled) {
                    showError(json);
                }
            }
            return false;
        }

        this.ensureConnectedToBackend = async function () {
            if (!self.bridge) {
                $("#vault-dropdown").css("display", "none");
                show(VaultFeedbacks.vaultLoading);
                try {
                    await vault.askVaultPermission();
                } catch (ex) {
                    if (ex == vault.errors.notRunning)
                        show(VaultFeedbacks.noVault);
                    else if (ex == vault.errors.denied)
                        show(VaultFeedbacks.vaultDenied);
                    return false;
                }
                show(VaultFeedbacks.vaultGranted);
                try {
                    self.bridge = await vault.connectToBackendSocket(self.backend_uri);
                    show(VaultFeedbacks.bridgeConnected);
                } catch (ex) {
                    if (ex == vault.errors.socketNotSupported)
                        show(VaultFeedbacks.noWebsockets);
                    if (ex == vault.errors.socketError)
                        show(VaultFeedbacks.errorWebsockets);
                    return false;
                }
            }
            return true;
        };
        this.askForDevice = async function () {
            if (!await self.ensureConnectedToBackend())
                return false;
            show(VaultFeedbacks.fetchingDevice);
            self.bridge.socket.send("ask-device");
            var json = await self.bridge.waitBackendMessage();
            if (json.hasOwnProperty("error")) {
                showError(json);
                return false;
            }
            show(VaultFeedbacks.deviceFound.replace("{{0}}", json.model));
            return true;
        };
        this.askForXPubs = async function () {
            if (!await self.ensureConnectedToBackend())
                return false;
            show(VaultFeedbacks.fetchingXpubs);
            self.bridge.socket.send("ask-xpubs");
            var json = await self.bridge.waitBackendMessage();
            if (json.hasOwnProperty("error")) {
                if (await needRetry(json))
                    return await self.askForXPubs();
                return false;
            }
            show(VaultFeedbacks.fetchedXpubs);
            self.xpubs = json;
            return true;
        };

        /**
         * @returns {Promise<string>}
         */
        this.getUserEnterPin = function () {
            show(VaultFeedbacks.needPin);
            $("#pin-input").css("display", "block");
            $("#vault-confirm").css("display", "block");
            $("#vault-confirm").text("Confirm the pin code");
            return new Promise(function (resolve, reject) {
                var pinCode = "";
                $("#vault-confirm").click(async function () {
                    $("#pin-input").css("display", "none");
                    $("#vault-confirm").css("display", "none");
                    $(this).unbind();
                    $(".pin-button").unbind();
                    $("#pin-display-delete").unbind();
                    resolve(pinCode);
                });
                $("#pin-display-delete").click(function () {
                    pinCode = "";
                    $("#pin-display").val("");
                });
                $(".pin-button").click(function () {
                    var id = $(this).attr('id').replace("pin-", "");
                    pinCode = pinCode + id;
                    $("#pin-display").val($("#pin-display").val() + "*");
                });
            });
        };

        /**
         * @returns {Promise<string>}
         */
        this.getUserPassphrase = function () {
            show(VaultFeedbacks.needPassphrase);
            $("#passphrase-input").css("display", "block");
            $("#vault-confirm").css("display", "block");
            $("#vault-confirm").text("Confirm the passphrase");
            return new Promise(function (resolve, reject) {
                $("#vault-confirm").click(async function () {
                    var passphrase = $("#Password").val();
                    if (passphrase !== $("#PasswordConfirmation").val()) {
                        show(VaultFeedbacks.invalidPasswordConfirmation);
                        return;
                    }
                    $("#passphrase-input").css("display", "none");
                    $("#vault-confirm").css("display", "none");
                    $(this).unbind();
                    resolve(passphrase);
                });
            });
        };

        this.askForPassphrase = async function () {
            if (!await self.ensureConnectedToBackend())
                return false;
            var passphrase = await self.getUserPassphrase();
            self.bridge.socket.send("set-passphrase");
            self.bridge.socket.send(passphrase);
            return true;
        }

        /**
         * @returns {Promise}
         */
        this.askForPin = async function () {
            if (!await self.ensureConnectedToBackend())
                return false;
            
            self.bridge.socket.send("ask-pin");
            var json = await self.bridge.waitBackendMessage();
            if (json.hasOwnProperty("error")) {
                if (await needRetry(json))
                    return await self.askForPin();
                return false;
            }

            var pinCode = await self.getUserEnterPin();
            self.bridge.socket.send(pinCode);
            var json = await self.bridge.waitBackendMessage();
            if (json.hasOwnProperty("error")) {
                showError(json);
                return false;
            }
            return true;
        }

        /**
         * @returns {Promise<Boolean>}
         */
        this.askSignPSBT = async function (args) {
            if (!await self.ensureConnectedToBackend())
                return false;
            show(VaultFeedbacks.signingTransaction);
            self.bridge.socket.send("ask-sign");
            var json = await self.bridge.waitBackendMessage();
            if (json.hasOwnProperty("error")) {
                if (await needRetry(json))
                    return await self.askSignPSBT(args);
                return false;
            }
            self.bridge.socket.send(JSON.stringify(args));
            json = await self.bridge.waitBackendMessage();
            if (json.hasOwnProperty("error")) {
                if (await needRetry(json))
                    return await self.askSignPSBT(args);
                return false;
            }
            self.psbt = json.psbt;
            return true;
        };
    }
    return {
        VaultFeedback: VaultFeedback,
        VaultBridgeUI: VaultBridgeUI
    };
})();
