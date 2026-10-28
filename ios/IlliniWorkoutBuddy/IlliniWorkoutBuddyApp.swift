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
    @State private var showingFirstTour = false
    @State private var showingTourPrompt = false
    @EnvironmentObject private var store: AppStore

    private var tourPromptStorageKey: String? {
        store.currentUser.map { "answeredWorkoutBuddyTourPrompt-\($0.id)" }
    }

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
            NavigationStack { AppHelpView(showingTour: $showingFirstTour) }
                .tabItem { Label("Help", systemImage: "questionmark.circle") }
                .tag(5)
        }
        .onAppear(perform: offerTourOnce)
        .alert("Would you like a quick tour?", isPresented: $showingTourPrompt) {
            Button("Start tour") {
                markTourPromptAnswered()
                showingFirstTour = true
            }
            Button("Not now", role: .cancel) {
                markTourPromptAnswered()
            }
        } message: {
            Text("Learn how to set up your profile, find a workout buddy, and make a plan. You can replay the tour anytime from Help.")
        }
        .sheet(isPresented: $showingFirstTour, onDismiss: markTourSeen) {
            GettingStartedTour()
        }
    }

    private func offerTourOnce() {
        guard let key = tourPromptStorageKey, !UserDefaults.standard.bool(forKey: key) else { return }
        showingTourPrompt = true
    }

    private func markTourPromptAnswered() {
        guard let key = tourPromptStorageKey else { return }
        UserDefaults.standard.set(true, forKey: key)
    }

    private func markTourSeen() {
        guard let key = tourPromptStorageKey else { return }
        UserDefaults.standard.set(true, forKey: key)
    }
}

private struct TourStep: Identifiable {
    let id: Int
    let title: String
    let detail: String
    let symbol: String
}

private struct GettingStartedTour: View {
    @Environment(\.dismiss) private var dismiss
    @State private var stepIndex = 0

    private let steps = [
        TourStep(id: 0, title: "Set up your profile", detail: "Add the activities and gyms you like, plus who you feel comfortable working out with. Your full name and @username appear to other members.", symbol: "person.crop.circle"),
        TourStep(id: 1, title: "Add your free times", detail: "Enter weekly windows in Schedule, or import a calendar file or screenshot. Review suggestions before saving; imports do not stay synced.", symbol: "calendar"),
        TourStep(id: 2, title: "Find a workout buddy", detail: "Buddies are matched using overlapping free times, activities, gym locations, and partner preferences. Your private schedule is not shown.", symbol: "person.2.fill"),
        TourStep(id: 3, title: "Chat and make a plan", detail: "Start a chat, then send a dated workout invitation. Your buddy can accept, decline, or cancel it in Meetups.", symbol: "bubble.left.and.bubble.right.fill"),
        TourStep(id: 4, title: "Stay in control", detail: "Working out now is optional and expires automatically. You can block or report someone from their profile or chat.", symbol: "hand.raised.fill")
    ]

    private var step: TourStep { steps[stepIndex] }

    var body: some View {
        NavigationStack {
            VStack(spacing: 22) {
                Image(systemName: step.symbol)
                    .font(.system(size: 42, weight: .medium))
                    .foregroundStyle(Color(red: 0.87, green: 0.34, blue: 0.17))
                    .accessibilityHidden(true)
                Text(step.title)
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                Text(step.detail)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Step \(stepIndex + 1) of \(steps.count)")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button(stepIndex == steps.count - 1 ? "Get started" : "Next") {
                    if stepIndex == steps.count - 1 { dismiss() }
                    else { stepIndex += 1 }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
            }
            .padding(28)
            .frame(maxWidth: 520, maxHeight: .infinity)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Skip") { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(false)
    }
}

private struct AppHelpView: View {
    @EnvironmentObject private var store: AppStore
    @Binding var showingTour: Bool
    @State private var question = ""
    @State private var answer: String?
    @State private var error: String?
    @State private var assistantAvailable: Bool?
    @State private var sending = false

    var body: some View {
        Form {
            Section("Getting started") {
                Text("Complete your profile, add free times, find someone who matches, then chat and choose a workout date.")
                    .font(.subheadline)
                Button("Replay the app tour", systemImage: "arrow.counterclockwise") {
                    showingTour = true
                }
            }
            Section("Ask Gemini") {
                Text("Ask about using the app or general workout questions. Only the question you type is sent; Gemini cannot see your profile, schedule, or chats.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if assistantAvailable == false {
                    Label("AI answers are not set up yet. The app tour still works.", systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                TextField("Ask a question", text: $question, axis: .vertical)
                    .lineLimit(2...5)
                    .accessibilityIdentifier("assistant-question")
                Button {
                    submitQuestion()
                } label: {
                    if sending { ProgressView() }
                    else { Label("Ask Gemini", systemImage: "sparkles") }
                }
                .disabled(sending || assistantAvailable != true || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let answer {
                    Text(answer)
                        .font(.body)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("assistant-answer")
                }
                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                if assistantAvailable == nil {
                    ProgressView("Checking AI availability…")
                        .font(.footnote)
                }
            }
            Section("Privacy and safety") {
                Text("The assistant does not use your saved app data to answer. It is not a medical professional; ask a qualified professional about injuries or health concerns.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Help")
        .task { await checkAvailability() }
    }

    private func checkAvailability() async {
        do {
            assistantAvailable = try await store.assistantIsAvailable()
            error = nil
        } catch {
            assistantAvailable = false
            self.error = "Could not check AI availability. Try again later."
        }
    }

    private func submitQuestion() {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 600 else {
            error = "Keep your question under 600 characters."
            return
        }
        sending = true
        answer = nil
        error = nil
        Task {
            do {
                answer = try await store.askAssistant(trimmed)
                question = ""
            } catch {
                self.error = error.localizedDescription
            }
            sending = false
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
