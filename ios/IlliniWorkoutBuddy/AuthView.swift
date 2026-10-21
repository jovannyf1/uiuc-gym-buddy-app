import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var store: AppStore
    @State private var registering = false
    @State private var name = ""
    @State private var netID = ""
    @State private var password = ""
    @State private var registeringEmail = false
    @State private var emailName = ""
    @State private var email = ""
    @State private var emailPassword = ""
    @State private var awaitingVerification = false
    @State private var requestingPasswordReset = false
    @State private var emailNotice: String?
    @State private var busy = false
    @State private var error: String?
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Image(systemName: "figure.run.circle.fill")
                        .font(.system(size: 54))
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Show up stronger, together.")
                            .font(.largeTitle.bold())
                        Text("Find a workout buddy who is free when you are.")
                            .foregroundStyle(.secondary)
                    }

                    if store.netIDAvailable {
                        Button {
                            submitNetID()
                        } label: {
                            Label("Sign in with Illinois NetID", systemImage: "person.badge.key.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy)
                    }

                    if store.emailAuthAvailable {
                        emailForm
                    }

                    if store.pilotAuthAvailable {
                        Text("Local pilot account")
                            .font(.headline)
                        Picker("Account", selection: $registering) {
                            Text("Sign in").tag(false)
                            Text("Create account").tag(true)
                        }
                        .pickerStyle(.segmented)

                        VStack(spacing: 14) {
                            if registering {
                                TextField("Your name", text: $name)
                                    .textContentType(.name)
                                    .textInputAutocapitalization(.words)
                            }
                            TextField("NetID or Illinois email", text: $netID)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                            SecureField("Password", text: $password)
                                .textContentType(registering ? .newPassword : .password)
                            Text("This pilot account uses an @illinois.edu address. It is separate from campus NetID sign-in.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .textFieldStyle(.roundedBorder)

                        Button {
                            submitPassword()
                        } label: {
                            if busy { ProgressView().frame(maxWidth: .infinity) }
                            else { Text(registering ? "Create pilot account" : "Sign in to pilot account").frame(maxWidth: .infinity) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy || netID.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
                    }

                    if !store.netIDAvailable && !store.pilotAuthAvailable && !store.emailAuthAvailable {
                        Text("Sign-in is not configured on this server yet. Check the server address or ask the app operator to enable sign-in.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    if let error {
                        Text(error).foregroundStyle(.red).font(.callout)
                    }

                    Text("Only the free times you choose to save are used for matching. Schedule uploads are reviewed first.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Illini Workout Buddy")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Server", systemImage: "gearshape") { showingSettings = true }
                }
            }
            .sheet(isPresented: $showingSettings) { ServerSettingsView() }
        }
    }

    private var emailForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Email and password")
                .font(.headline)

            if requestingPasswordReset {
                Text("Reset your password")
                    .font(.title3.bold())
                Text("Enter your email. Open the reset link from your inbox in a browser, then come back here to sign in.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Email address", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Send password-reset link") { requestPasswordReset() }
                    .disabled(busy || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Back to sign in") {
                    requestingPasswordReset = false
                    emailNotice = nil
                }
                    .disabled(busy)
            } else if awaitingVerification {
                Text("Check your email")
                    .font(.title3.bold())
                Text("Open the verification link in your email, then come back here to sign in. Check your spam folder if you do not see it.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Email address", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Resend verification email") { resendVerification() }
                    .disabled(busy || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Back to sign in") {
                    registeringEmail = false
                    awaitingVerification = false
                    emailNotice = nil
                }
                    .disabled(busy)
            } else {
                Picker("Email account", selection: $registeringEmail) {
                    Text("Sign in").tag(false)
                    Text("Create account").tag(true)
                }
                .pickerStyle(.segmented)

                if registeringEmail {
                    TextField("Your name", text: $emailName)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                        .textFieldStyle(.roundedBorder)
                }
                TextField("Email address", text: $email)
                    .textContentType(registeringEmail ? .emailAddress : .username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                SecureField("Password", text: $emailPassword)
                    .textContentType(registeringEmail ? .newPassword : .password)
                    .textFieldStyle(.roundedBorder)

                if registeringEmail {
                    Text("We’ll email a verification link before you can sign in. Verifying an address does not confirm student status.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button { submitEmail() } label: {
                    if busy { ProgressView().frame(maxWidth: .infinity) }
                    else { Text(registeringEmail ? "Create email account" : "Sign in with email").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                          || emailPassword.isEmpty
                          || (registeringEmail && emailName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))

                if !registeringEmail {
                    VStack(alignment: .leading, spacing: 10) {
                        Button("Forgot password?") {
                            requestingPasswordReset = true
                            emailNotice = nil
                        }
                        Button("Need a verification email?") {
                            awaitingVerification = true
                            emailNotice = nil
                        }
                    }
                    .disabled(busy)
                }
            }

            if let emailNotice {
                Text(emailNotice)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func submitEmail() {
        busy = true
        error = nil
        emailNotice = nil
        Task {
            do {
                if registeringEmail {
                    emailNotice = try await store.registerEmail(name: emailName, email: email, password: emailPassword)
                    emailPassword = ""
                    awaitingVerification = true
                } else {
                    try await store.loginWithEmail(email: email, password: emailPassword)
                    emailPassword = ""
                }
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func resendVerification() {
        busy = true
        error = nil
        emailNotice = nil
        Task {
            do {
                emailNotice = try await store.resendEmailVerification(email: email)
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func requestPasswordReset() {
        busy = true
        error = nil
        emailNotice = nil
        Task {
            do {
                emailNotice = try await store.requestEmailPasswordReset(email: email)
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func submitPassword() {
        busy = true
        error = nil
        Task {
            do {
                if registering {
                    try await store.register(name: name, netID: netID, password: password)
                } else {
                    try await store.login(netID: netID, password: password)
                }
                password = ""
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func submitNetID() {
        busy = true
        error = nil
        Task {
            do { try await store.loginWithNetID() }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

struct ServerSettingsView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("App server") {
                    TextField("Server URL", text: $address)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Text("For a hosted app, use its HTTPS address. For testing on your iPhone, use your Mac’s .local network name and port 8787 while the server is running.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
                Section {
                    Button("Save server address") {
                        do {
                            try store.setServerURL(address)
                            Task { await store.checkNetIDAvailability() }
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
            }
            .navigationTitle("Server settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .onAppear { address = store.baseURLText }
        }
    }
}
