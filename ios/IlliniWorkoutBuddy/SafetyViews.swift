import SwiftUI

struct SafetyMenu: View {
    let user: UserProfile
    @EnvironmentObject private var store: AppStore
    @State private var showingReport = false
    @State private var showingBlockConfirmation = false

    var body: some View {
        Menu {
            Button("Report \(user.name)", systemImage: "flag") { showingReport = true }
            Button(role: .destructive) {
                showingBlockConfirmation = true
            } label: {
                Label("Block \(user.name)", systemImage: "hand.raised")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .accessibilityLabel("Safety options for \(user.name)")
        }
        .sheet(isPresented: $showingReport) { ReportSheet(user: user) }
        .confirmationDialog("Block \(user.name)?", isPresented: $showingBlockConfirmation) {
            Button("Block member", role: .destructive) {
                Task {
                    do { try await store.blockUser(user.id) }
                    catch { store.errorMessage = error.localizedDescription }
                }
            }
        } message: {
            Text("They will disappear from matches and live workouts, and any meetup between you will be cancelled. You can unblock them later.")
        }
    }
}

struct ReportSheet: View {
    let user: UserProfile
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "harassment"
    @State private var details = ""
    @State private var sending = false
    @State private var error: String?

    private let reasons = [
        ("harassment", "Harassment"),
        ("spam", "Spam"),
        ("unsafe", "Unsafe behavior"),
        ("other", "Other")
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Report \(user.name) if their profile, messages, or behavior made you feel unsafe. Your report will be saved for review.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Section("Reason") {
                    Picker("Reason", selection: $reason) {
                        ForEach(reasons.indices, id: \.self) { index in
                            Text(reasons[index].1).tag(reasons[index].0)
                        }
                    }
                    TextField("What happened? (optional)", text: $details, axis: .vertical)
                        .lineLimit(3...6)
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button("Send report") { send() }
                        .disabled(sending || details.count > 500)
                }
            }
            .navigationTitle("Report member")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { dismiss() } } }
        }
    }

    private func send() {
        sending = true
        error = nil
        Task {
            do {
                try await store.reportUser(user.id, reason: reason, details: details)
                dismiss()
            } catch { self.error = error.localizedDescription }
            sending = false
        }
    }
}
