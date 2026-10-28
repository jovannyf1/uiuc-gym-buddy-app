import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var store: AppStore
    @State private var name = ""
    @State private var username = ""
    @State private var bio = ""
    @State private var gender = "prefer-not-to-say"
    @State private var preference = "any"
    @State private var experience = "beginner"
    @State private var activities: Set<String> = []
    @State private var locations: Set<String> = []
    @State private var showingServer = false
    @State private var saved = false

    private var usernameReady: Bool {
        let value = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value.range(of: "^[a-z0-9_]{3,24}$", options: .regularExpression) != nil
    }

    var body: some View {
        Form {
            Section("About you") {
                TextField("Name", text: $name)
                TextField("Username", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("profile-username")
                Text("Your unique @username uses 3–24 letters, numbers, or underscores.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextField("A short introduction", text: $bio, axis: .vertical)
                    .lineLimit(3...6)
                Picker("Experience", selection: $experience) {
                    ForEach(GymData.experienceLevels, id: \.self) { Text($0.capitalized).tag($0) }
                }
                Picker("Gender", selection: $gender) {
                    ForEach(GymData.genders, id: \.self) { value in
                        Text(value == "prefer-not-to-say" ? "Prefer not to say" : value.capitalized).tag(value)
                    }
                }
                Picker("Partner preference", selection: $preference) {
                    ForEach(GymData.preferences, id: \.self) { Text($0.capitalized).tag($0) }
                }
                Text("Your partner preference is private and used only for matching.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section("Workouts you enjoy") {
                ForEach(GymData.activities, id: \.self) { value in
                    Toggle(value, isOn: membership(value, in: $activities))
                }
            }
            Section("Gyms you can meet at") {
                ForEach(GymData.locations, id: \.self) { value in
                    Toggle(value, isOn: membership(value, in: $locations))
                }
            }
            Section {
                AsyncActionButton {
                    let payload = ProfilePayload(name: name,
                        username: username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                        gender: gender,
                        partnerPreference: preference, experience: experience,
                        activities: GymData.activities.filter { activities.contains($0) },
                        locations: GymData.locations.filter { locations.contains($0) }, bio: bio)
                    try await store.updateProfile(payload)
                    saved = true
                } label: {
                    Label("Save profile", systemImage: "checkmark.circle.fill")
                }
                .disabled(!usernameReady)
                if saved { Text("Profile saved.").foregroundStyle(.green) }
            }
            Section("Account") {
                if let email = store.currentUser?.email { LabeledContent("Email", value: email) }
                if let verified = store.currentUser?.emailVerified {
                    LabeledContent("Email status", value: verified ? "Verified" : "Not verified")
                }
                Button("Server settings", systemImage: "server.rack") { showingServer = true }
                Button("Sign out", role: .destructive) {
                    Task { await store.logout() }
                }
            }
            if !store.blockedUsers.isEmpty {
                Section("Blocked members") {
                    ForEach(store.blockedUsers) { user in
                        HStack {
                            Text(user.name)
                            Spacer()
                            AsyncActionButton { try await store.unblockUser(user.id) } label: {
                                Text("Unblock")
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("My profile")
        .onAppear(perform: loadProfile)
        .sheet(isPresented: $showingServer) { ServerSettingsView() }
    }

    private func loadProfile() {
        guard let user = store.currentUser else { return }
        name = user.name
        username = user.username ?? ""
        bio = user.bio
        gender = user.gender
        preference = user.partnerPreference ?? "any"
        experience = user.experience
        activities = Set(user.activities)
        locations = Set(user.locations)
    }

    private func membership(_ value: String, in selection: Binding<Set<String>>) -> Binding<Bool> {
        Binding(
            get: { selection.wrappedValue.contains(value) },
            set: { selected in
                if selected { selection.wrappedValue.insert(value) }
                else { selection.wrappedValue.remove(value) }
            }
        )
    }
}
