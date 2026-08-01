import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../features/notes/controllers/notes_controller.dart';
import '../features/notes/data/notes_repository.dart';
import '../features/notes/views/note_list_page.dart';
import '../features/settings/controllers/appearance_controller.dart';
import '../features/settings/views/settings_page.dart';

class AnotaiApp extends StatefulWidget {
  const AnotaiApp({super.key});

  @override
  State<AnotaiApp> createState() => _AnotaiAppState();
}

class _AnotaiAppState extends State<AnotaiApp> {
  late final AppearanceController _appearanceController;
  late final NotesController _notesController;

  @override
  void initState() {
    super.initState();
    _appearanceController = AppearanceController();
    _notesController = NotesController(InMemoryNotesRepository.seeded());
  }

  @override
  void dispose() {
    _appearanceController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _appearanceController,
        builder: (context, _) => MaterialApp(
          title: 'anotAI',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: _appearanceController.themeMode,
          home: NoteListPage(
            controller: _notesController,
            onOpenSettings: (context) => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SettingsPage(controller: _appearanceController),
              ),
            ),
          ),
        ),
      );
}
