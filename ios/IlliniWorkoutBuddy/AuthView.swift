import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var store: AppStore
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

                    if store.emailAuthConfigurationLoading {
                        Text("Checking email sign-in…")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    } else if !store.emailAuthAvailable {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Email sign-in setup pending")
                                .font(.headline)
                            Text(store.emailAuthConfigurationError ?? "Account creation and sign-in have not been connected on this server yet.")
                                .font(.callout)
                        }
                        .foregroundStyle(.secondary)
                    }
                    emailForm

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
                Text("Enter your verified email. Open the reset link from your inbox in a browser, then come back here to sign in.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Email address", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Send password-reset link") { requestPasswordReset() }
                    .disabled(busy || !store.emailAuthAvailable || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Back to sign in") {
                    requestingPasswordReset = false
                    emailNotice = nil
                }
                    .disabled(busy)
            } else if awaitingVerification {
                Text("Get a verification link")
                    .font(.title3.bold())
                Text("You can sign in without verifying. If you need a link for an unverified account, enter its email address and check your inbox or spam folder.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Email address", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Send verification email") { resendVerification() }
                    .disabled(busy || !store.emailAuthAvailable || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
                    Text("You can use the app immediately. Verify your email later to keep password reset available. Your password must be at least 12 characters.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button { submitEmail() } label: {
                    if busy { ProgressView().frame(maxWidth: .infinity) }
                    else { Text(registeringEmail ? "Create email account" : "Sign in with email").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || !store.emailAuthAvailable
                          || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                          || emailPassword.isEmpty
                          || (registeringEmail && emailPassword.count < 12)
                          || (registeringEmail && emailName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))

                if !registeringEmail {
                    VStack(alignment: .leading, spacing: 10) {
                        Button("Forgot password?") {
                            requestingPasswordReset = true
                            emailNotice = nil
                        }
                        Button("Need a verification link?") {
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
                    try await store.registerEmail(name: emailName, email: email, password: emailPassword)
                    emailPassword = ""
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
                            Task { await store.checkEmailAuthAvailability() }
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
