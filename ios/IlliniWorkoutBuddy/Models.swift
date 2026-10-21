import Foundation

enum GymData {
    static let days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    static let activities = ["Strength training", "Cardio", "General workout", "Group fitness", "Stretching & mobility"]
    static let locations = ["ARC", "CRCE"]
    static let genders = ["male", "female", "nonbinary", "prefer-not-to-say"]
    static let preferences = ["any", "male", "female", "nonbinary"]
    static let experienceLevels = ["beginner", "intermediate", "advanced"]

    static func dayName(_ day: Int) -> String {
        days.indices.contains(day) ? days[day] : "Day \(day)"
    }

    static func displayTime(_ value: String) -> String {
        let input = DateFormatter()
        input.dateFormat = "HH:mm"
        input.timeZone = TimeZone(identifier: "America/Chicago")
        guard let date = input.date(from: value) else { return value }
        let output = DateFormatter()
        output.dateStyle = .none
        output.timeStyle = .short
        output.timeZone = TimeZone(identifier: "America/Chicago")
        return output.string(from: date)
    }

    static func timeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = TimeZone(identifier: "America/Chicago")
        return formatter.string(from: date)
    }

    static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "America/Chicago")
        return formatter.string(from: date)
    }

    static func weekday(_ date: Date) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        return (calendar.component(.weekday, from: date) + 5) % 7
    }

    static func minutes(_ time: String) -> Int? {
        let parts = time.split(separator: ":")
        guard parts.count == 2, let hours = Int(parts[0]), let minutes = Int(parts[1]),
              (0..<24).contains(hours), (0..<60).contains(minutes) else { return nil }
        return hours * 60 + minutes
    }
}

struct UserProfile: Codable, Identifiable, Hashable {
    let id: Int
    var name: String
    var gender: String
    var activities: [String]
    var experience: String
    var locations: [String]
    var bio: String
    var email: String?
    var partnerPreference: String?
}

struct TimeSlot: Codable, Hashable, Identifiable {
    var day: Int
    var start: String
    var end: String
    var id: String { "\(day)-\(start)-\(end)" }
    var label: String { "\(GymData.dayName(day)) · \(GymData.displayTime(start))–\(GymData.displayTime(end))" }
}

struct BuddyMatch: Codable, Identifiable {
    let user: UserProfile
    let overlaps: [TimeSlot]
    let sharedActivities: [String]
    let sharedLocations: [String]
    let score: Int
    var id: Int { user.id }
}

struct PersonRef: Codable, Hashable {
    let id: Int
    let name: String
}

struct Meetup: Codable, Identifiable {
    let id: Int
    let fromUser: PersonRef
    let toUser: PersonRef
    let activity: String
    let date: String
    let day: Int
    let start: String
    let end: String
    let location: String
    let note: String
    let status: String
    let createdAt: String

    func otherPerson(for userID: Int) -> PersonRef {
        fromUser.id == userID ? toUser : fromUser
    }
}

struct ImportPreview: Codable {
    let source: String
    let busy: [TimeSlot]
    let suggestedSlots: [TimeSlot]
    let warnings: [String]
}

struct WorkoutPresence: Codable {
    let activity: String
    let location: String
    let expiresAt: String
}

struct NearbyPerson: Codable, Identifiable {
    let user: UserProfile
    let activity: String
    let location: String
    let expiresAt: String
    var id: Int { user.id }
}

struct ChatMessage: Codable, Identifiable {
    let id: Int
    let senderUserId: Int
    let text: String
    let createdAt: String
}

struct ChatSummary: Codable, Identifiable {
    let id: Int
    let otherUser: UserProfile
    let lastMessage: ChatMessage?
    let updatedAt: String
}

struct RegisterPayload: Encodable {
    let name: String
    let email: String
    let password: String
}

struct LoginPayload: Encodable {
    let email: String
    let password: String
}

struct EmailResendPayload: Encodable { let email: String }

struct ProfilePayload: Encodable {
    let name: String
    let gender: String
    let partnerPreference: String
    let experience: String
    let activities: [String]
    let locations: [String]
    let bio: String
}

struct SlotsPayload: Encodable { let slots: [TimeSlot] }
struct PresencePayload: Encodable {
    let activity: String
    let location: String
    let durationMinutes: Int
}
struct ChatCreatePayload: Encodable { let toUserId: Int }
struct MessagePayload: Encodable { let text: String }
struct NativeNetIDCompletePayload: Encodable {
    let code: String
    let verifier: String
}
struct ReportPayload: Encodable {
    let reason: String
    let details: String
}
struct MeetupStatusPayload: Encodable { let status: String }
struct MeetupPayload: Encodable {
    let toUserId: Int
    let activity: String
    let date: String
    let day: Int
    let start: String
    let end: String
    let location: String
    let note: String
}

struct UserEnvelope: Decodable { let user: UserProfile }
struct SlotsEnvelope: Decodable { let slots: [TimeSlot] }
struct MatchesEnvelope: Decodable { let matches: [BuddyMatch] }
struct MeetupsEnvelope: Decodable { let meetups: [Meetup] }
struct MeetupEnvelope: Decodable { let meetup: Meetup }
struct PresenceEnvelope: Decodable { let presence: WorkoutPresence? }
struct NearbyEnvelope: Decodable { let people: [NearbyPerson] }
struct ChatsEnvelope: Decodable { let chats: [ChatSummary] }
struct ChatEnvelope: Decodable { let chat: ChatSummary }
struct MessagesEnvelope: Decodable { let messages: [ChatMessage] }
struct MessageEnvelope: Decodable { let message: ChatMessage }
struct OKEnvelope: Decodable { let ok: Bool }
struct NetIDConfigEnvelope: Decodable {
    let enabled: Bool
    let pilotAuthEnabled: Bool
    let emailAuthEnabled: Bool?
}
struct EmailRegistrationEnvelope: Decodable {
    let verificationRequired: Bool
    let message: String
}
struct EmailAcknowledgmentEnvelope: Decodable {
    let ok: Bool?
    let message: String?
}
struct BlocksEnvelope: Decodable { let blockedUsers: [UserProfile] }
struct BlockEnvelope: Decodable { let blocked: Bool }
struct ReportEnvelope: Decodable { let reported: Bool }
