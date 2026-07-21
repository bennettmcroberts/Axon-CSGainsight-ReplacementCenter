#!/usr/bin/env python3
"""Manage users for the Axon CS Command Center's lightweight login.

Usage:
    python manage_users.py add <username> [--name "Display Name"] [--csm "Owner Name"] [--role csm|manager|admin]
    python manage_users.py list
    python manage_users.py remove <username>

Passwords are prompted for interactively (not echoed, never passed as an
argument) and stored as a salted PBKDF2 hash in users.json - never plaintext.

--csm should match the person's Owner.Name in Salesforce/mock data (see the
"Owner" column anywhere in the app) so their "View as" scope defaults to their
own book on login. Leave it off for managers/admins who cover multiple books.
"""
from __future__ import annotations

import argparse
import getpass
import sys

from app.auth import USERS_FILE, find_user, hash_password, load_users, save_users


def cmd_add(args):
    if find_user(args.username):
        print(f"User '{args.username}' already exists - remove it first or choose a different username.")
        return 1
    password = getpass.getpass(f"Password for {args.username}: ")
    confirm = getpass.getpass("Confirm password: ")
    if not password:
        print("Password cannot be empty.")
        return 1
    if password != confirm:
        print("Passwords didn't match.")
        return 1
    salt, digest = hash_password(password)
    users = load_users()
    users.append({
        "username": args.username,
        "displayName": args.name or args.username,
        "csmName": args.csm,
        "role": args.role,
        "salt": salt,
        "passwordHash": digest,
    })
    save_users(users)
    print(f"Added '{args.username}' to {USERS_FILE}")
    return 0


def cmd_list(_args):
    users = load_users()
    if not users:
        print(f"No users yet - {USERS_FILE} is empty or missing. Add one with: python manage_users.py add <username>")
        return 0
    for u in users:
        print(f"  {u['username']:<20} {u.get('displayName',''):<24} role={u.get('role','csm'):<8} csm={u.get('csmName') or '-'}")
    return 0


def cmd_remove(args):
    users = load_users()
    remaining = [u for u in users if u["username"].lower() != args.username.lower()]
    if len(remaining) == len(users):
        print(f"No user named '{args.username}'.")
        return 1
    save_users(remaining)
    print(f"Removed '{args.username}'.")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_add = sub.add_parser("add", help="Add a new user")
    p_add.add_argument("username")
    p_add.add_argument("--name", dest="name", default=None, help="Display name (defaults to username)")
    p_add.add_argument("--csm", dest="csm", default=None, help="Matching Owner.Name for auto-scoping View as")
    p_add.add_argument("--role", dest="role", default="csm", choices=["csm", "manager", "admin"])
    p_add.set_defaults(func=cmd_add)

    p_list = sub.add_parser("list", help="List configured users")
    p_list.set_defaults(func=cmd_list)

    p_remove = sub.add_parser("remove", help="Remove a user")
    p_remove.add_argument("username")
    p_remove.set_defaults(func=cmd_remove)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
