import KmqMember from "./kmq_member";
import State from "../state";
import type Eris from "eris";

export default class MessageContext {
    /** The text channel to send the message to */
    public textChannelID: string;

    /** The author to represent the message as */
    public author: KmqMember;

    /** The guild ID to send the message to */
    public guildID: string;

    /** The ID of the originating message */
    public referencedMessageID: string;

    constructor(
        textChannelID: string,
        author?: KmqMember,
        guildID?: string,
        referencedMessageID?: string
    ) {
        this.textChannelID = textChannelID;
        this.author = author;
        if (!author) {
            const clientUser = State.client.user;
            this.author = new KmqMember(clientUser.id);
        }

        this.guildID = guildID;
        this.referencedMessageID = referencedMessageID;
    }

    /**
     * @param message - The Message object
     * @returns a MessageContext
     */
    static fromMessage(message: Eris.Message): MessageContext {
        return new MessageContext(
            message.channel.id,
            new KmqMember(message.author.id),
            message.guildID,
            message.id
        );
    }
}
