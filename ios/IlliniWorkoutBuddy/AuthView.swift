import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var store: AppStore
    @State private var registering = false
    @State private var name = ""
    @State private var netID = ""
    @State private var password = ""
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
                        Text("Find another UIUC student who wants to work out when you do.")
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

                    if store.pilotAuthAvailable {
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

                    if !store.netIDAvailable && !store.pilotAuthAvailable {
                        Text("Sign-in is not configured on this server yet. Check the server address or ask the app operator to enable Illinois NetID sign-in.")
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
