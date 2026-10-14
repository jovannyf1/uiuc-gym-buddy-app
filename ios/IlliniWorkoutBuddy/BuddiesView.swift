import SwiftUI

struct BuddiesView: View {
    @EnvironmentObject private var store: AppStore
    @State private var activity = GymData.activities[0]
    @State private var location = GymData.locations[0]
    @State private var duration = 60
    @State private var selectedMatch: BuddyMatch?
    @State private var activeChat: ChatSummary?
    @State private var openingChat = false

    var body: some View {
        List {
            Section {
                Text("Find someone with shared free time, or let nearby buddies know you are working out now.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Section("Working out now") {
                if let presence = store.presence {
                    LabeledContent("Your status", value: "\(presence.activity) at \(presence.location)")
                    Text("Visible to compatible buddies until \(presence.expiresAt.formattedTimestamp)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    AsyncActionButton {
                        try await store.stopPresence()
                    } label: {
                        Label("Stop sharing workout status", systemImage: "stop.circle")
                    }
                } else if let me = store.currentUser, !me.activities.isEmpty, !me.locations.isEmpty {
                    Picker("Workout", selection: $activity) {
                        ForEach(me.activities, id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Gym", selection: $location) {
                        ForEach(me.locations, id: \.self) { Text($0).tag($0) }
                    }
                    Picker("For", selection: $duration) {
                        Text("30 minutes").tag(30)
                        Text("1 hour").tag(60)
                        Text("2 hours").tag(120)
                    }
                    AsyncActionButton {
                        try await store.startPresence(activity: activity, location: location, durationMinutes: duration)
                    } label: {
                        Label("I'm working out now", systemImage: "figure.run")
                    }
                } else {
                    Text("Add a workout and gym to your profile to share a live status.")
                        .foregroundStyle(.secondary)
                }

                if store.nearby.isEmpty {
                    Text("No compatible buddies are sharing a workout status right now.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.nearby) { person in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(person.user.name).font(.headline)
                                Spacer()
                                SafetyMenu(user: person.user)
                            }
                            Text("\(person.activity) · \(person.location)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Button("Chat with \(person.user.name)") { openChat(with: person.user.id) }
                                .disabled(openingChat)
                        }
                    }
                }
            }

            Section("Matches for your free time") {
                if store.matches.isEmpty {
                    EmptyMessage(symbol: "person.2", title: "No matches yet", detail: "Add free times and choose workouts and gyms in your profile. Matches appear when another student has compatible availability.")
                } else {
                    ForEach(store.matches) { match in
                        VStack(alignment: .leading, spacing: 9) {
                            HStack {
                                Text(match.user.name).font(.headline)
                                Spacer()
                                SafetyMenu(user: match.user)
                            }
                            if !match.user.bio.isEmpty { Text(match.user.bio).font(.subheadline) }
                            Text("\(match.sharedActivities.joined(separator: ", ")) · \(match.sharedLocations.joined(separator: ", "))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Text(match.overlaps.prefix(2).map(\.label).joined(separator: "\n"))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            HStack {
                                Button("Invite to work out") { selectedMatch = match }
                                    .buttonStyle(.borderedProminent)
                                Button("Chat") { openChat(with: match.user.id) }
                                    .buttonStyle(.bordered)
                                    .disabled(openingChat)
                            }
                        }
                        .padding(.vertical, 5)
                    }
                }
            }
        }
        .navigationTitle("Find a buddy")
        .overlay { if openingChat { ProgressView().controlSize(.large) } }
        .refreshable {
            do {
                try await store.refreshMatches()
                try await store.refreshNearby()
            } catch { store.errorMessage = error.localizedDescription }
        }
        .task {
            if let me = store.currentUser {
                activity = me.activities.first ?? GymData.activities[0]
                location = me.locations.first ?? GymData.locations[0]
            }
            while !Task.isCancelled {
                try? await store.refreshSocial()
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .sheet(item: $selectedMatch) { match in InviteSheet(match: match) }
        .sheet(item: $activeChat) { chat in
            NavigationStack { ChatConversationView(chat: chat) }
        }
    }

    private func openChat(with userID: Int) {
        openingChat = true
        Task {
            do { activeChat = try await store.createChat(with: userID) }
            catch { store.errorMessage = error.localizedDescription }
            openingChat = false
        }
    }
}

private struct InviteOption: Identifiable {
    let date: Date
    let slot: TimeSlot
    var id: String { "\(GymData.dateString(date))-\(slot.id)" }
    var label: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeZone = TimeZone(identifier: "America/Chicago")
        return "\(formatter.string(from: date)) · \(GymData.displayTime(slot.start))–\(GymData.displayTime(slot.end))"
    }
}

struct InviteSheet: View {
    let match: BuddyMatch
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var optionID: String
    @State private var activity: String
    @State private var location: String
    @State private var startTime: Date
    @State private var endTime: Date
    @State private var note = ""
    @State private var error: String?
    @State private var sending = false

    init(match: BuddyMatch) {
        self.match = match
        let first = Self.options(for: match).first
        _optionID = State(initialValue: first?.id ?? "")
        _activity = State(initialValue: match.sharedActivities.first ?? GymData.activities[0])
        _location = State(initialValue: match.sharedLocations.first ?? GymData.locations[0])
        _startTime = State(initialValue: Self.dateForTime(first?.slot.start ?? "17:00"))
        let end = Self.defaultEnd(for: first?.slot)
        _endTime = State(initialValue: Self.dateForTime(end))
    }

    private var options: [InviteOption] { Self.options(for: match) }
    private var chosen: InviteOption? { options.first(where: { $0.id == optionID }) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Invite \(match.user.name) to a specific time and gym. They can accept or decline.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Section("Workout plan") {
                    Picker("Date and shared window", selection: $optionID) {
                        ForEach(options) { option in Text(option.label).tag(option.id) }
                    }
                    Picker("Activity", selection: $activity) {
                        ForEach(match.sharedActivities, id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Meeting place", selection: $location) {
                        ForEach(match.sharedLocations, id: \.self) { Text($0).tag($0) }
                    }
                    DatePicker("From", selection: $startTime, displayedComponents: .hourAndMinute)
                    DatePicker("Until", selection: $endTime, displayedComponents: .hourAndMinute)
                    Text("Times are in Central Time. Choose at least 30 minutes within your shared window.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    TextField("Optional message", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button {
                        send()
                    } label: {
                        if sending { ProgressView() }
                        else { Text("Send invitation") }
                    }
                    .disabled(sending || chosen == nil)
                }
            }
            .navigationTitle("Workout invite")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { dismiss() } } }
            .onChange(of: optionID) { _, newValue in
                if let option = options.first(where: { $0.id == newValue }) {
                    startTime = Self.dateForTime(option.slot.start)
                    endTime = Self.dateForTime(Self.defaultEnd(for: option.slot))
                }
            }
        }
    }

    private func send() {
        guard let chosen else { return }
        let start = GymData.timeString(startTime)
        let end = GymData.timeString(endTime)
        guard let startMinutes = GymData.minutes(start), let endMinutes = GymData.minutes(end),
              let windowStart = GymData.minutes(chosen.slot.start), let windowEnd = GymData.minutes(chosen.slot.end),
              startMinutes >= windowStart, endMinutes <= windowEnd, endMinutes - startMinutes >= 30 else {
            error = "Choose at least 30 minutes within the shared free window."
            return
        }
        sending = true
        error = nil
        Task {
            do {
                let payload = MeetupPayload(toUserId: match.user.id, activity: activity,
                    date: GymData.dateString(chosen.date), day: chosen.slot.day,
                    start: start, end: end, location: location, note: note)
                try await store.sendInvite(payload)
                dismiss()
            } catch { self.error = error.localizedDescription }
            sending = false
        }
    }

    private static func options(for match: BuddyMatch) -> [InviteOption] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        let today = calendar.startOfDay(for: Date())
        return (1...28).flatMap { offset -> [InviteOption] in
            guard let date = calendar.date(byAdding: .day, value: offset, to: today) else { return [] }
            let day = GymData.weekday(date)
            return match.overlaps.filter { $0.day == day }.map { InviteOption(date: date, slot: $0) }
        }
    }

    private static func dateForTime(_ value: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = TimeZone(identifier: "America/Chicago")
        return formatter.date(from: value) ?? Date()
    }

    private static func defaultEnd(for slot: TimeSlot?) -> String {
        guard let slot, let start = GymData.minutes(slot.start), let end = GymData.minutes(slot.end) else { return "18:00" }
        let minute = min(start + 60, end)
        return String(format: "%02d:%02d", minute / 60, minute % 60)
    }
}

private extension String {
    var formattedTimestamp: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: self) else { return self }
        let output = DateFormatter()
        output.dateStyle = .short
        output.timeStyle = .short
        output.timeZone = TimeZone(identifier: "America/Chicago")
        return output.string(from: date)
    }
}
