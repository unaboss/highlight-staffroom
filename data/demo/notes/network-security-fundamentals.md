# Chapter 1: The CIA triad

<!-- page 1 -->
## 1.1 Confidentiality, integrity and availability

Information security is usually described with three goals known as the CIA triad. Confidentiality means that information is only seen by people who are allowed to see it. Integrity means that information is accurate and has not been changed without permission. Availability means that information and systems can be used when they are needed.

Security controls are chosen to protect one or more of these goals. For example, encrypting a laptop's disk protects confidentiality if the laptop is stolen, a checksum protects integrity by showing whether a file was altered, and a backup protects availability if the original data is lost.

<!-- page 2 -->
## 1.2 Balancing the three goals

The three goals sometimes pull against each other. A system that locks every account after one wrong password protects confidentiality but hurts availability. Good security design finds a balance that fits what the organisation needs. Hospitals, for example, put a high value on availability because doctors need patient records immediately, while a bank puts a high value on integrity because account balances must never be changed by mistake.

# Chapter 2: Threats, vulnerabilities and risk

<!-- page 3 -->
## 2.1 Key terms

A threat is anything that could cause harm to a system, such as an attacker, a piece of malware or a flood. A vulnerability is a weakness that a threat could exploit, such as unpatched software or a weak password. An exploit is the method or code that takes advantage of a vulnerability. Risk is the chance that a threat will exploit a vulnerability, combined with the harm it would cause.

<!-- page 4 -->
## 2.2 Assessing and treating risk

A simple way to assess risk is to rate the likelihood of an event and its impact, and multiply the two. Organisations can treat a risk in four ways: avoid it by stopping the risky activity, reduce it with security controls, transfer it, for example through insurance, or accept it when the cost of fixing it is higher than the possible harm. Patching software is one of the most effective ways to reduce risk because it removes known vulnerabilities.

# Chapter 3: How networks work: TCP/IP and ports

<!-- page 5 -->
## 3.1 IP addresses and packets

Data travels across a network in small units called packets. Each packet carries a source IP address and a destination IP address so that routers can forward it towards the right device. An IPv4 address is written as four numbers between 0 and 255, such as 192.168.1.10. Private address ranges such as 192.168.0.0/16 and 10.0.0.0/8 are used inside homes and organisations and are not routed on the public internet.

<!-- page 6 -->
## 3.2 TCP and UDP

TCP and UDP are the two main transport protocols. TCP is connection-oriented: it sets up a connection with a three-way handshake (SYN, SYN-ACK, ACK), numbers the data and resends anything that is lost, so it is reliable. UDP is connectionless: it sends datagrams without a handshake and without resending lost data, which makes it faster and suited to live video, voice calls and DNS lookups.

<!-- page 7 -->
## 3.3 Ports and services

A port number identifies which service on a device should receive the data. Port numbers range from 0 to 65535. Well-known services use standard ports: for example, HTTP uses port 80, HTTPS uses port 443, SSH uses port 22 and DNS uses port 53. An open port is a port where a service is listening for connections. Every open port is a possible way in for an attacker, so services that are not needed should be turned off.

# Chapter 4: Firewalls and network segmentation

<!-- page 8 -->
## 4.1 What a firewall does

A firewall is a security control that inspects network traffic and decides whether to allow or block it based on a set of rules. A firewall rule usually matches the source address, the destination address, the protocol and the port. Firewalls can be hardware appliances that protect a whole network, or software firewalls that run on a single computer, such as the firewall built into Windows.

<!-- page 9 -->
## 4.2 Rules and default deny

Firewall rules are checked from top to bottom, and the first rule that matches decides what happens to the traffic. A good rule set follows the principle of default deny: everything is blocked unless a rule specifically allows it. For example, a school web server might allow incoming traffic on port 443 for HTTPS from anywhere, allow SSH on port 22 only from the IT office, and block everything else.

<!-- page 10 -->
## 4.3 Stateless and stateful firewalls

A stateless firewall looks at each packet on its own and compares it with the rules. A stateful firewall keeps track of connections, so it knows which packets belong to a conversation that was already allowed. This means a stateful firewall can automatically allow the replies to a request that a user inside the network made, while still blocking new connections that start from outside. Next-generation firewalls add features such as application awareness and intrusion prevention.

<!-- page 11 -->
## 4.4 Network segmentation and the DMZ

Network segmentation means dividing a network into separate zones so that a problem in one zone does not spread to the others. For example, a school can put student devices, staff computers and servers on different segments and use firewall rules to control the traffic between them. A DMZ, or demilitarised zone, is a segment for servers that must be reached from the internet, such as a public web server, so that if one of them is compromised the attacker is still separated from the internal network.

# Chapter 5: Passwords, hashing and multi-factor authentication

<!-- page 12 -->
## 5.1 Strong passwords and passphrases

Authentication is the process of proving who you are. A strong password is long and hard to guess, and a passphrase made of several random words is both strong and easy to remember. Length matters more than complexity, because each extra character multiplies the number of guesses an attacker must try. Reusing a password is risky because a leak from one website lets attackers try the same password on other accounts, an attack called credential stuffing. A password manager helps people use a different strong password for every account.

<!-- page 13 -->
## 5.2 Hashing and salting

Systems should never store passwords in plain text. Instead they store a hash, which is the output of a one-way function that turns the password into a fixed-length value that cannot be reversed. When a user logs in, the system hashes the password they type and compares it with the stored hash. A salt is a random value added to each password before hashing so that two users with the same password get different hashes, which defeats precomputed rainbow tables. Slow password hashing algorithms such as bcrypt and Argon2 are designed to make guessing expensive.

<!-- page 14 -->
## 5.3 Multi-factor authentication

Multi-factor authentication, or MFA, requires two or more different kinds of evidence: something you know, such as a password, something you have, such as a phone or security key, and something you are, such as a fingerprint. MFA protects an account even when the password has been stolen. Authenticator apps and hardware security keys are stronger than codes sent by SMS, because SMS messages can be intercepted or redirected through SIM swapping.

# Chapter 6: Phishing and social engineering

<!-- page 15 -->
## 6.1 How social engineering works

Social engineering is the use of manipulation to trick people into giving away information or access. Attackers use pressure such as urgency, fear, curiosity or authority to stop people from thinking carefully. Phishing is a social engineering attack that uses fake emails or messages to make people click a malicious link, open an infected attachment or enter their password on a fake login page. Spear phishing targets a specific person using details about them, and pretexting uses an invented story, such as pretending to be from the IT help desk.

<!-- page 16 -->
## 6.2 Spotting and reporting phishing

Warning signs of phishing include an unexpected request, a sender address that does not match the organisation, urgent or threatening language, spelling mistakes and links whose real address differs from the text shown. You should hover over a link to check its real address before clicking, and verify unusual requests through a separate channel, such as calling the person on a known number. Reporting suspicious messages quickly lets the IT team warn others and block the attack.

# Chapter 7: Malware and how to defend against it

<!-- page 17 -->
## 7.1 Types of malware

Malware is software designed to cause harm. A virus attaches itself to a file or program and spreads when that file is run. A worm spreads by itself across a network without needing a user to run anything. A trojan pretends to be useful software while hiding a harmful function. Ransomware encrypts a victim's files and demands payment for the key, and spyware secretly collects information such as keystrokes or browsing activity.

<!-- page 18 -->
## 7.2 Defences against malware

Defences against malware work in layers. Keeping operating systems and applications patched removes many of the vulnerabilities that malware uses. Antivirus and endpoint detection tools look for known malware signatures and suspicious behaviour. Users should only install software from trusted sources and should not use an administrator account for everyday work. Regular backups that are stored offline are the most important defence against ransomware, because they let an organisation restore its files without paying.

# Chapter 8: Encryption: symmetric and asymmetric

<!-- page 19 -->
## 8.1 Symmetric encryption

Encryption turns readable plaintext into unreadable ciphertext using an algorithm and a key, and decryption turns it back. Symmetric encryption uses the same secret key to encrypt and decrypt. It is fast, which makes it suitable for large amounts of data, and AES is the most widely used symmetric algorithm. The main problem with symmetric encryption is key distribution: both sides need the same secret key without an attacker learning it.

<!-- page 20 -->
## 8.2 Asymmetric encryption

Asymmetric encryption, also called public key cryptography, uses a pair of keys: a public key that can be shared with anyone and a private key that the owner keeps secret. Data encrypted with someone's public key can only be decrypted with their private key. RSA and elliptic curve cryptography are common asymmetric algorithms. Asymmetric encryption is slower than symmetric encryption, so in practice it is often used to exchange a symmetric key safely, and the symmetric key then encrypts the actual data.

<!-- page 21 -->
## 8.3 Digital signatures

A digital signature proves who sent a message and that it was not changed on the way. The sender creates the signature with their private key, and anyone can check it with the sender's public key. Digital signatures therefore support integrity and authenticity.

# Chapter 9: TLS and certificates

<!-- page 22 -->
## 9.1 How HTTPS protects web traffic

HTTPS is HTTP sent over TLS, which stands for Transport Layer Security. TLS encrypts the traffic between a browser and a website so that people on the same network cannot read or change it. During the TLS handshake, the browser and the server agree on encryption settings, the server proves its identity with a certificate, and the two sides create shared symmetric keys for the session.

<!-- page 23 -->
## 9.2 Certificates and certificate authorities

A digital certificate links a website's domain name to its public key. Certificates are issued by a certificate authority, or CA, which checks that the requester controls the domain and then signs the certificate. Browsers trust a built-in list of root certificate authorities, and they show a warning when a certificate has expired, does not match the domain or was not signed by a trusted CA. Users should not click past these warnings, because they can mean that someone is intercepting the connection.

# Chapter 10: Logging and incident response

<!-- page 24 -->
## 10.1 Logs and monitoring

A log is a time-stamped record of events, such as logins, failed login attempts, firewall decisions and system errors. Collecting logs from many systems in one place lets defenders spot patterns that would be invisible on a single machine. A SIEM, which stands for security information and event management, is a tool that gathers logs, correlates them and raises alerts. For example, many failed logins followed by one success from an unusual country could indicate a brute-force attack.

<!-- page 25 -->
## 10.2 The incident response process

An incident is an event that harms or threatens the confidentiality, integrity or availability of systems or data. Incident response usually follows these phases: preparation, identification, containment, eradication, recovery and lessons learned. Containment means limiting the damage, for example by disconnecting an infected computer from the network. Eradication removes the cause, recovery restores normal operation, and the lessons-learned review improves defences so the same incident does not happen again.
