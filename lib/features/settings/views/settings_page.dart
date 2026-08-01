import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../controllers/appearance_controller.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({required this.controller, super.key});

  final AppearanceController controller;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: controller,
        builder: (context, _) => Scaffold(
          appBar: AppBar(
            leadingWidth: 104,
            leading: TextButton.icon(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(CupertinoIcons.chevron_back, size: 20),
              label: const Text('Notes'),
            ),
            title: const Text('Settings'),
          ),
          body: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            children: [
              _Section(
                title: 'Appearance',
                child: SegmentedButton<ThemeMode>(
                  segments: const [
                    ButtonSegment(
                      value: ThemeMode.light,
                      icon: Icon(CupertinoIcons.sun_max),
                      label: Text('Light'),
                    ),
                    ButtonSegment(
                      value: ThemeMode.dark,
                      icon: Icon(CupertinoIcons.moon),
                      label: Text('Dark'),
                    ),
                    ButtonSegment(
                      value: ThemeMode.system,
                      icon: Icon(CupertinoIcons.device_phone_portrait),
                      label: Text('System'),
                    ),
                  ],
                  selected: {controller.themeMode},
                  onSelectionChanged: (selection) =>
                      controller.setThemeMode(selection.first),
                  showSelectedIcon: false,
                ),
              ),
              const SizedBox(height: 20),
              const _Section(
                title: 'AI editing',
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.auto_awesome_rounded),
                  title: Text('Coming in the next phase'),
                  subtitle: Text(
                    'Provider keys, models, and agent behavior are intentionally '
                    'outside this UI rewrite.',
                  ),
                ),
              ),
              const SizedBox(height: 20),
              const _Section(
                title: 'About',
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('anotAI'),
                  subtitle: Text('Flutter UI prototype · local-first notes'),
                ),
              ),
            ],
          ),
        ),
      );
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            title.toUpperCase(),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.primary,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                ),
          ),
        ),
        Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(16),
          clipBehavior: Clip.antiAlias,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: SizedBox(width: double.infinity, child: child),
          ),
        ),
      ],
    );
  }
}
