import * as proto from './proto/message';
import Ciphertext from './crypto/Ciphertext';
import { KeyBundle, PrivateKeyBundle, PublicKey } from './crypto';
import { decrypt, encrypt } from './crypto/encryption';

export class Header implements proto.Message_Header {
  sender: KeyBundle | undefined;
  recipient: KeyBundle | undefined;
  decrypted: string | undefined;

  constructor(obj: proto.Message_Header) {
    if (obj.sender) {
      this.sender = new KeyBundle(obj.sender);
    }
    if (obj.recipient) {
      this.recipient = new KeyBundle(obj.recipient);
    }
  }

  toBytes(): Uint8Array {
    return proto.Message_Header.encode(this).finish();
  }

  static fromBytes(bytes: Uint8Array): Header {
    return new Header(proto.Message_Header.decode(bytes));
  }
}

export default class Message implements proto.Message {
  header: Header | undefined;
  ciphertext: Ciphertext | undefined;
  decrypted: string | undefined;

  constructor(obj: proto.Message) {
    if (obj.header) {
      this.header = new Header(obj.header);
    }
    if (obj.ciphertext) {
      this.ciphertext = new Ciphertext(obj.ciphertext);
    }
  }

  toBytes(): Uint8Array {
    return proto.Message.encode(this).finish();
  }

  static fromBytes(bytes: Uint8Array): Message {
    return new Message(proto.Message.decode(bytes));
  }

  // encrypt and serialize the message
  static async encode(
    sender: PrivateKeyBundle,
    recipient: KeyBundle,
    message: string
  ): Promise<Message> {
    const bytes = new TextEncoder().encode(message);
    const ciphertext = await this.encrypt(bytes, sender, recipient);
    const msg = new Message({
      header: {
        sender: sender.getKeyBundle(),
        recipient
      },
      ciphertext
    });
    msg.decrypted = message;
    return msg;
  }

  // deserialize and decrypt the message;
  // throws if any part of the messages (including the header) was tampered with
  static async decode(
    recipient: PrivateKeyBundle,
    bytes: Uint8Array
  ): Promise<Message> {
    const message = proto.Message.decode(bytes);
    if (!message.header) {
      throw new Error('missing message header');
    }
    if (!message.header.sender) {
      throw new Error('missing message sender');
    }
    if (!message.header.recipient) {
      throw new Error('missing message recipient');
    }
    if (!message.header.recipient?.preKey) {
      throw new Error('missing message recipient pre key');
    }
    const sender = new KeyBundle(message.header.sender);
    if (!recipient.preKey) {
      throw new Error('missing message recipient pre key');
    }
    if (recipient.preKeys.length === 0) {
      throw new Error('missing pre key');
    }
    if (
      !recipient.preKey.matches(new PublicKey(message.header.recipient.preKey))
    ) {
      throw new Error('recipient pre-key mismatch');
    }
    if (!message.ciphertext?.aes256GcmHkdfSha256) {
      throw new Error('missing message ciphertext');
    }
    const ciphertext = new Ciphertext(message.ciphertext);
    bytes = await this.decrypt(ciphertext, sender, recipient);
    const msg = new Message(message);
    msg.decrypted = new TextDecoder().decode(bytes);
    return msg;
  }

  // encrypt the plaintext with a symmetric key derived from the peers' key bundles.
  static async encrypt(
    plain: Uint8Array,
    sender: PrivateKeyBundle,
    recipient: KeyBundle
  ): Promise<Ciphertext> {
    const secret = await sender.sharedSecret(recipient, false);
    const ad = associatedData({
      sender: sender.getKeyBundle(),
      recipient: recipient
    });
    return encrypt(plain, secret, ad);
  }

  // decrypt the encrypted content using a symmetric key derived from the peers' key bundles.
  static async decrypt(
    encrypted: Ciphertext,
    sender: KeyBundle,
    recipient: PrivateKeyBundle
  ): Promise<Uint8Array> {
    const secret = await recipient.sharedSecret(sender, true);
    const ad = associatedData({
      sender: sender,
      recipient: recipient.getKeyBundle()
    });
    return decrypt(encrypted, secret, ad);
  }
}

// argument type for associatedData()
interface AssociatedData {
  sender: KeyBundle;
  recipient: KeyBundle;
}

// serializes message header into bytes so that it can be included for encryption as associated data
function associatedData(header: AssociatedData): Uint8Array {
  return proto.Message_Header.encode({
    sender: header.sender,
    recipient: header.recipient
  }).finish();
}
