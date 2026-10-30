package me.unframe;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class QuestCredentialStorage {
    private static String identifier(String scope) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(scope.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format("%02x", value & 255));
        return result.toString();
    }

    private static AtomicFile file(Context context, String scope) throws Exception {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "unframe-account-" + identifier(scope)));
    }

    private static SecretKey key(String scope, boolean create) throws Exception {
        String alias = "unframe.account." + identifier(scope);
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        if (!create) throw new IllegalStateException("Credential key is unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    public static synchronized String read(Context context, String scope) throws Exception {
        AtomicFile storage = file(context, scope);
        if (!storage.getBaseFile().exists()) return null;
        if (storage.getBaseFile().length() > 65536) throw new IllegalStateException("Invalid credential storage");
        try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(storage.readFully()))) {
            if (input.readInt() != 1) throw new IllegalStateException("Invalid credential storage");
            byte[] iv = new byte[12];
            input.readFully(iv);
            int length = input.readInt();
            if (length < 16 || length > 32768 || input.available() != length) throw new IllegalStateException("Invalid credential storage");
            byte[] encrypted = new byte[length];
            input.readFully(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(scope, false), new GCMParameterSpec(128, iv));
            cipher.updateAAD(scope.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        }
    }

    public static synchronized String write(Context context, String scope, String value) throws Exception {
        byte[] plain = value.getBytes(StandardCharsets.UTF_8);
        if (plain.length > 32752) throw new IllegalArgumentException("Invalid credential length");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(scope, true));
        cipher.updateAAD(scope.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(plain);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream output = new DataOutputStream(bytes)) {
            output.writeInt(1);
            output.write(cipher.getIV());
            output.writeInt(encrypted.length);
            output.write(encrypted);
        }
        AtomicFile storage = file(context, scope);
        FileOutputStream stream = null;
        try {
            stream = storage.startWrite();
            stream.write(bytes.toByteArray());
            storage.finishWrite(stream);
        } catch (Exception error) {
            if (stream != null) storage.failWrite(stream);
            throw error;
        }
        return null;
    }

    public static synchronized String delete(Context context, String scope) throws Exception {
        file(context, scope).delete();
        return null;
    }
}
