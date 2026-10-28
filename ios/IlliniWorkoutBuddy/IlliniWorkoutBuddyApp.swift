import SwiftUI

@main
struct IlliniWorkoutBuddyApp: App {
    @StateObject private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .task { await store.restoreSession() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        Task { await store.refreshAccountStatus() }
                    }
                }
                .alert("Something went wrong", isPresented: Binding(
                    get: { store.errorMessage != nil },
                    set: { if !$0 { store.errorMessage = nil } }
                )) {
                    Button("OK") { store.errorMessage = nil }
                } message: {
                    Text(store.errorMessage ?? "Please try again.")
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        Group {
            if store.loadingSession {
                ProgressView("Connecting to Illini Workout Buddy…")
            } else if store.currentUser == nil {
                AuthView()
            } else {
                VStack(spacing: 0) {
                    if store.currentUser?.emailVerified == false {
                        EmailVerificationReminder()
                    }
                    MainTabsView()
                }
            }
        }
        .tint(Color(red: 0.87, green: 0.34, blue: 0.17))
        .environment(\.timeZone, TimeZone(identifier: "America/Chicago")!)
    }
}

private struct EmailVerificationReminder: View {
    @EnvironmentObject private var store: AppStore
    @State private var sending = false
    @State private var message: String?
    @State private var isError = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Verify your email to protect your account")
                .font(.subheadline.bold())
            Text("You can use the app now. Verification lets you reset your password if you forget it.")
                .font(.footnote)
            Button {
                sending = true
                message = nil
                Task {
                    do {
                        message = try await store.sendEmailVerification()
                        isError = false
                    } catch {
                        message = error.localizedDescription
                        isError = true
                    }
                    sending = false
                }
            } label: {
                if sending { ProgressView() }
                else { Label("Send verification email", systemImage: "envelope") }
            }
            .buttonStyle(.bordered)
            .disabled(sending)
            if let message {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(isError ? Color.red : Color.green)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12))
        .accessibilityIdentifier("email-verification-reminder")
    }
}

struct MainTabsView: View {
    @State private var selection = 0

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack { BuddiesView() }
                .tabItem { Label("Buddies", systemImage: "person.2.fill") }
                .tag(0)
            NavigationStack { ScheduleView() }
                .tabItem { Label("Schedule", systemImage: "calendar") }
                .tag(1)
            NavigationStack { MeetupsView() }
                .tabItem { Label("Meetups", systemImage: "figure.strengthtraining.traditional") }
                .tag(2)
            NavigationStack { ChatsView() }
                .tabItem { Label("Chats", systemImage: "bubble.left.and.bubble.right.fill") }
                .tag(3)
            NavigationStack { ProfileView() }
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
                .tag(4)
        }
    }
}

struct AsyncActionButton<Label: View>: View {
    let action: () async throws -> Void
    let label: () -> Label
    @EnvironmentObject private var store: AppStore
    @State private var working = false

    init(action: @escaping () async throws -> Void, @ViewBuilder label: @escaping () -> Label) {
        self.action = action
        self.label = label
    }

    var body: some View {
        Button {
            working = true
            Task {
                do { try await action() }
                catch { store.errorMessage = error.localizedDescription }
                working = false
            }
        } label: {
            if working { ProgressView() }
            else { label() }
        }
        .disabled(working)
    }
}

struct EmptyMessage: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text(detail))
    }
}
