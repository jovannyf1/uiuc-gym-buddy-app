import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit

struct ScheduleView: View {
    @EnvironmentObject private var store: AppStore
    @State private var day = 0
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(3600)
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var showingCalendarPicker = false
    @State private var importing = false
    @State private var preview: ImportPreview?
    @State private var selectedSuggestions: Set<String> = []
    @State private var repeatConfirmed = false
    @State private var localError: String?

    var body: some View {
        Form {
            Section {
                Text("Choose times you are usually free for a workout. Only saved free windows are used to find buddies.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Section("Add a weekly free time") {
                Picker("Day", selection: $day) {
                    ForEach(0..<7) { day in Text(GymData.dayName(day)).tag(day) }
                }
                DatePicker("From", selection: $start, displayedComponents: .hourAndMinute)
                DatePicker("Until", selection: $end, displayedComponents: .hourAndMinute)
                AsyncActionButton {
                    let newSlot = TimeSlot(day: day, start: GymData.timeString(start), end: GymData.timeString(end))
                    try await store.saveSlots(store.slots + [newSlot])
                } label: {
                    Label("Add free time", systemImage: "plus.circle.fill")
                }
            }

            Section("Your weekly availability") {
                if store.slots.isEmpty {
                    Text("No times saved yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(store.slots.sorted(by: { $0.day == $1.day ? $0.start < $1.start : $0.day < $1.day })) { slot in
                        HStack {
                            Text(slot.label)
                            Spacer()
                            AsyncActionButton {
                                try await store.saveSlots(store.slots.filter { $0 != slot })
                            } label: {
                                Image(systemName: "trash").foregroundStyle(.red)
                            }
                            .accessibilityLabel("Remove \(slot.label)")
                        }
                    }
                }
            }

            Section("Import a schedule") {
                Text("Import an Outlook, Google, or Apple .ics export, or a screenshot of your schedule. Suggestions are never saved until you select and confirm them.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Choose calendar export (.ics)", systemImage: "calendar.badge.plus") {
                    showingCalendarPicker = true
                }
                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Label("Choose schedule screenshot", systemImage: "photo")
                }
                if importing { ProgressView("Reading schedule…") }
            }

            if let preview {
                Section("Review suggested free times") {
                    ForEach(preview.warnings, id: \.self) { warning in
                        Label(warning, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if preview.suggestedSlots.isEmpty {
                        Text("No open windows found. Try another screenshot or add free times manually.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(preview.suggestedSlots) { slot in
                            Toggle(slot.label, isOn: Binding(
                                get: { selectedSuggestions.contains(slot.id) },
                                set: { selected in
                                    if selected { selectedSuggestions.insert(slot.id) }
                                    else { selectedSuggestions.remove(slot.id) }
                                }
                            ))
                        }
                        Toggle("Save my selected times as weekly recurring availability. I will update them when my schedule changes.", isOn: $repeatConfirmed)
                            .font(.footnote)
                        AsyncActionButton {
                            let chosen = preview.suggestedSlots.filter { selectedSuggestions.contains($0.id) }
                            try await store.saveSlots(store.slots + chosen)
                            self.preview = nil
                            selectedSuggestions = []
                            repeatConfirmed = false
                        } label: {
                            Label("Save selected free times", systemImage: "checkmark.circle.fill")
                        }
                        .disabled(selectedSuggestions.isEmpty || !repeatConfirmed)
                    }
                }
            }

            if let localError {
                Section { Text(localError).foregroundStyle(.red) }
            }
        }
        .navigationTitle("My schedule")
        .refreshable {
            do { try await store.refreshSchedule() }
            catch { store.errorMessage = error.localizedDescription }
        }
        .fileImporter(isPresented: $showingCalendarPicker, allowedContentTypes: [UTType(filenameExtension: "ics") ?? .data]) { result in
            Task { await importCalendar(result) }
        }
        .onChange(of: selectedPhoto) { _, newValue in
            guard let newValue else { return }
            Task { await importPhoto(newValue) }
        }
    }

    @MainActor
    private func importCalendar(_ result: Result<URL, Error>) async {
        do {
            let url = try result.get()
            guard url.startAccessingSecurityScopedResource() else {
                throw APIError(message: "The calendar file could not be opened.", statusCode: nil)
            }
            defer { url.stopAccessingSecurityScopedResource() }
            let data = try Data(contentsOf: url)
            try await runPreview(data: data, filename: "schedule.ics", mimeType: "text/calendar")
        } catch { localError = error.localizedDescription }
    }

    @MainActor
    private func importPhoto(_ item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data),
                  let jpeg = image.jpegData(compressionQuality: 0.92) else {
                throw APIError(message: "This screenshot could not be opened as an image.", statusCode: nil)
            }
            try await runPreview(data: jpeg, filename: "schedule.jpg", mimeType: "image/jpeg")
        } catch { localError = error.localizedDescription }
        selectedPhoto = nil
    }

    @MainActor
    private func runPreview(data: Data, filename: String, mimeType: String) async throws {
        importing = true
        localError = nil
        defer { importing = false }
        let result = try await store.previewSchedule(data: data, filename: filename, mimeType: mimeType)
        preview = result
        selectedSuggestions = []
        repeatConfirmed = false
    }
}
