import SwiftUI

struct ChatsView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        List {
            if store.chats.isEmpty {
                EmptyMessage(symbol: "bubble.left.and.bubble.right", title: "No chats yet", detail: "Start a chat with a compatible buddy from Find a buddy.")
            } else {
                ForEach(store.chats) { chat in
                    NavigationLink {
                        ChatConversationView(chat: chat)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(chat.otherUser.name).font(.headline)
                            Text(chat.lastMessage?.text ?? "Start the conversation")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
        .navigationTitle("Chats")
        .refreshable {
            do { try await store.refreshChats() }
            catch { store.errorMessage = error.localizedDescription }
        }
        .task {
            while !Task.isCancelled {
                try? await store.refreshChats()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }
}

struct ChatConversationView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let chat: ChatSummary
    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var loadError: String?

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty {
                            Text("Say hello and agree on a time and place to meet.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 30)
                        }
                        ForEach(messages) { message in
                            HStack {
                                if message.senderUserId == store.currentUser?.id { Spacer(minLength: 45) }
                                Text(message.text)
                                    .padding(11)
                                    .background(message.senderUserId == store.currentUser?.id ? Color.orange.opacity(0.22) : Color.gray.opacity(0.15))
                                    .clipShape(RoundedRectangle(cornerRadius: 13))
                                if message.senderUserId != store.currentUser?.id { Spacer(minLength: 45) }
                            }
                            .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            if let loadError {
                Text(loadError).foregroundStyle(.red).font(.footnote).padding(.horizontal)
            }
            HStack(spacing: 10) {
                TextField("Message \(chat.otherUser.name)", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                Button {
                    send()
                } label: {
                    if sending { ProgressView() }
                    else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                }
                .accessibilityLabel("Send message")
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding()
            .background(.regularMaterial)
        }
        .navigationTitle(chat.otherUser.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                SafetyMenu(user: chat.otherUser)
            }
        }
        .task {
            while !Task.isCancelled {
                do {
                    messages = try await store.messages(for: chat.id)
                    loadError = nil
                } catch {
                    loadError = error.localizedDescription
                }
                try? await Task.sleep(for: .seconds(8))
            }
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true
        Task {
            do {
                let message = try await store.sendMessage(text, to: chat.id)
                if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
                draft = ""
                loadError = nil
            } catch { loadError = error.localizedDescription }
            sending = false
        }
    }
}
