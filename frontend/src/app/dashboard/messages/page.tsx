"use client";

import { useState, useEffect } from "react";
import { MessageSquare, Send } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export default function MessagesPage() {
  const { user } = useAuth();
  const [inbox, setInbox] = useState<any[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchInbox = async () => {
    setLoading(true);
    try { const res = await api.get("/communication/messages/inbox"); setInbox(res.data.data || []); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchInbox(); }, []);

  const openConversation = async (partner: any) => {
    setSelectedPartner(partner);
    try {
      const res = await api.get(`/communication/messages/${partner.partnerId}`);
      setMessages(res.data.data || []);
    } catch {}
  };

  const sendMessage = async () => {
    if (!newMsg.trim() || !selectedPartner) return;
    try {
      await api.post("/communication/messages", { receiverId: selectedPartner.partnerId, content: newMsg });
      setNewMsg("");
      openConversation(selectedPartner);
    } catch {}
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><MessageSquare className="h-6 w-6 text-primary-600" /> Messages</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[70vh]">
        {/* Inbox */}
        <div className="card overflow-y-auto">
          <h3 className="font-semibold mb-3 text-sm text-gray-500">Conversations</h3>
          {loading ? <p className="text-gray-400 text-sm">Loading...</p> : inbox.length === 0 ? <p className="text-gray-400 text-sm">No messages</p> : (
            <div className="space-y-1">
              {inbox.map(c => (
                <button key={c.partnerId} onClick={() => openConversation(c)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${selectedPartner?.partnerId === c.partnerId ? "bg-primary-50" : "hover:bg-gray-50"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{c.partner?.name}</span>
                    {c.unread > 0 && <span className="w-5 h-5 bg-primary-600 text-white text-xs rounded-full flex items-center justify-center">{c.unread}</span>}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{c.lastMessage}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chat */}
        <div className="lg:col-span-2 card flex flex-col">
          {selectedPartner ? (<>
            <div className="pb-3 border-b mb-3"><h3 className="font-semibold">{selectedPartner.partner?.name}</h3><p className="text-xs text-gray-400">{selectedPartner.partner?.role}</p></div>
            <div className="flex-1 overflow-y-auto space-y-2 mb-3">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.senderId === user?.id ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${m.senderId === user?.id ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-800"}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-3 border-t">
              <input className="input-field flex-1" placeholder="Type a message..." value={newMsg} onChange={e => setNewMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} />
              <button onClick={sendMessage} className="btn-primary"><Send className="h-4 w-4" /></button>
            </div>
          </>) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">Select a conversation</div>
          )}
        </div>
      </div>
    </div>
  );
}
