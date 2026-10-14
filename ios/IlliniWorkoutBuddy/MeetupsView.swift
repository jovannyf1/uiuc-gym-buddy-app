import SwiftUI

struct MeetupsView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        List {
            if store.meetups.isEmpty {
                EmptyMessage(symbol: "calendar.badge.clock", title: "No workouts planned", detail: "Find a buddy with shared free time and send a dated invitation.")
            } else {
                ForEach(store.meetups) { meetup in
                    MeetupRow(meetup: meetup)
                }
            }
        }
        .navigationTitle("Meetups")
        .refreshable {
            do { try await store.refreshMeetups() }
            catch { store.errorMessage = error.localizedDescription }
        }
    }
}

private struct MeetupRow: View {
    @EnvironmentObject private var store: AppStore
    let meetup: Meetup

    private var isRecipient: Bool { meetup.toUser.id == store.currentUser?.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(meetup.otherPerson(for: store.currentUser?.id ?? -1).name)
                    .font(.headline)
                Spacer()
                Text(meetup.status.capitalized)
                    .font(.caption.bold())
                    .foregroundStyle(meetup.status == "accepted" ? Color.green : Color.secondary)
            }
            Text("\(meetup.activity) · \(meetup.location)")
            Text("\(meetup.date) · \(GymData.displayTime(meetup.start))–\(GymData.displayTime(meetup.end)) CT")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if !meetup.note.isEmpty {
                Text("“\(meetup.note)”")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if meetup.status == "pending" && isRecipient {
                HStack {
                    AsyncActionButton { try await store.respondToMeetup(meetup.id, status: "accepted") } label: {
                        Text("Accept")
                    }
                    .buttonStyle(.borderedProminent)
                    AsyncActionButton { try await store.respondToMeetup(meetup.id, status: "declined") } label: {
                        Text("Decline")
                    }
                    .buttonStyle(.bordered)
                }
            } else if meetup.status == "pending" || meetup.status == "accepted" {
                AsyncActionButton { try await store.respondToMeetup(meetup.id, status: "cancelled") } label: {
                    Text("Cancel workout")
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 6)
    }
}
