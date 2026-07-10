import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { receiverId, content } = req.body;
    const message = await prisma.message.create({
      data: { senderId: req.user!.userId, receiverId, content },
    });
    sendSuccess(res, message, "Message sent", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const myId = req.user!.userId;

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: myId, receiverId: userId },
          { senderId: userId, receiverId: myId },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    // Mark as read
    await prisma.message.updateMany({
      where: { senderId: userId, receiverId: myId, isRead: false },
      data: { isRead: true },
    });

    sendSuccess(res, messages, "Conversation fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getInbox = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const myId = req.user!.userId;

    // Get latest message from each conversation partner
    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: myId }, { receiverId: myId }] },
      orderBy: { createdAt: "desc" },
    });

    // Group by conversation partner
    const conversations: Record<string, any> = {};
    for (const msg of messages) {
      const partnerId = msg.senderId === myId ? msg.receiverId : msg.senderId;
      if (!conversations[partnerId]) {
        conversations[partnerId] = { partnerId, lastMessage: msg.content, lastAt: msg.createdAt, unread: 0 };
      }
      if (msg.receiverId === myId && !msg.isRead) conversations[partnerId].unread++;
    }

    // Get partner names
    const partnerIds = Object.keys(conversations);
    const users = await prisma.user.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, name: true, role: true, avatar: true },
    });

    const inbox = Object.values(conversations).map((c: any) => ({
      ...c,
      partner: users.find(u => u.id === c.partnerId),
    }));

    sendSuccess(res, inbox, "Inbox fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
