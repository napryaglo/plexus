// View resources for the Agent capability. DataTemplate[AgentService] renders
// the transcript (an ItemsControl over $Transcript) above an input row (a
// TextBox bound to $Draft + a Send button bound to $SendCommand). Item templates
// render each transcript Model by DataType. Merged app-global by app.mu.
// Render-through-templates rule: all chat chrome lives here, none in TS.

import AgentService from "./services/agent-service.js"
import UserMessage from "./services/transcript.js"
import AssistantMessage from "./services/transcript.js"
import ToolActivity from "./services/transcript.js"
import QuestionCard from "./services/question-card.js"
import QuestionVM from "./services/question-card.js"
import OptionVM from "./services/question-card.js"
import NewProjectCard from "./services/new-project-card.js"
import ToolApprovalCard from "./services/approval-card.js"
import ApprovalRuleRow from "./services/approval-rules.js"

resources AgentChatResources {
    DataTemplate [ DataType = AgentService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            resources: {
                // Enter-to-send. The single-line TextBox leaves Return unhandled,
                // so KeyDown bubbles to the input-row DockPanel (a descendant this
                // implicit style matches). The EventTrigger invokes SubmitCommand,
                // which sends only on Return and clears $Draft. A Style is the only
                // place `on <Event>` is allowed; DockPanel has no default style to
                // clobber and its local Dock/Margin attrs win over the (setter-less)
                // style.
                Style [ TargetType = DockPanel ] {
                    on KeyDown { InvokeCommand [ Command = $SubmitCommand ] }
                }
            }
            // Approved tools — the current project's persistent approval rules, each
            // with a Revoke. Pinned to the top, shown only when the project has rules.
            StackPanel [ DockPanel.Dock = Top, Orientation = Vertical,
                         Visibility = $Approvals.HasRules << ToVisibility, Margin = (0,0,0,8) ] {
                TextBlock [ Style = @LabelSmall, Text = "APPROVED TOOLS", Foreground = @OnSurfaceVariant, Margin = (0,0,0,4) ]
                ItemsControl [ ItemsSource = $Approvals.Rules, ItemsPanel = @VerticalStackPanel ]
            }
            // Input row pinned to the bottom. Disabled ($CanInput = false) while a
            // question card is awaiting an answer — the user must resolve it first.
            DockPanel [ DockPanel.Dock = Bottom, LastChildFill = true, Margin = (0,8,0,0) ] {
                PanelButton [ DockPanel.Dock = Right, Command = $SendCommand, IsEnabled = $CanInput, Margin = (8,0,0,0) ] {
                    Shape [ Geometry = @ArrowUpward, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                }
                TextBox [ Text = $Draft, IsEnabled = $CanInput ]
            }
            // Scrolling transcript fills the rest. AutoScrollToEnd keeps the
            // latest message pinned to the bottom while the user is at the end
            // (sticky — scrolling up to read history is not interrupted).
            ScrollViewer [ HorizontalScrollEnabled = false, AutoScrollToEnd = true ] {
                ItemsControl [ ItemsSource = $Transcript, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    DataTemplate [ DataType = UserMessage ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 8,
                 Padding = (10,6,10,6), Margin = (40,3,0,3) ] {
            TextBlock [ Style = @BodyMedium, Text = $Text, Foreground = @OnSurface, TextWrapping = Wrap ]
        }
    }

    // The agent writes markdown; $Document is the parsed FlowDocument and the
    // RichTextBlock lays it out with real formatting (headings, bold/italic,
    // inline + fenced code, lists, quotes, links). Foreground inherits to runs.
    DataTemplate [ DataType = AssistantMessage ] {
        Border [ Padding = (10,6,10,6), Margin = (0,3,40,3) ] {
            RichTextBlock [ Document = $Document, Foreground = @OnSurface ]
        }
    }

    // Borderless header button — a full-width clickable row (name + description +
    // status) that toggles the tool card open/closed. Transparent with a neutral
    // hover/press state layer; content is left-aligned (not centred like a Button).
    Template x:key="ToolHeaderButton" [ TargetType = Button ] {
        Border x:name="PART_Border" [ Background = #00000000, CornerRadius = 6 ] {
            Border x:name="PART_StateLayer"
                [ Background = #00000000, CornerRadius = 6, Padding = (6,4,6,4) ] {
                ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Background = @StateHoverOverlay; }
        when ( IsPressed ) { PART_StateLayer.Background = @StatePressOverlay; }
    }

    // Mono block used for both IN and OUT — a tinted, outlined box with the
    // command / output in a monospace face. ClipToBounds keeps a long
    // unbreakable token (a path, a hash) from spilling past the rounded corners.
    Style x:key="ToolMonoBox" [ TargetType = Border ] {
        Background = @SurfaceContainerHigh;
        BorderBrush = @OutlineVariant;
        BorderThickness = (1);
        CornerRadius = 6;
        Padding = (8,6,8,6);
        ClipToBounds = true;
    }

    // The agent invoked a tool: a collapsible card. The header (name +
    // description + status) is always shown and toggles the body; the body holds
    // the IN (command / input) and OUT (captured result) mono blocks. Starts
    // collapsed — $IsCollapsed shows the ▸ caret, $IsExpanded reveals the body.
    DataTemplate [ DataType = ToolActivity ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1), CornerRadius = 8,
                 Background = @SurfaceContainerLow, Padding = (4), Margin = (0,3,20,3) ] {
            StackPanel [ Orientation = Vertical ] {
                Button [ Command = $ToggleCommand, Template = @ToolHeaderButton, HorizontalAlignment = Stretch ] {
                    DockPanel [ LastChildFill = true ] {
                        TextBlock [ DockPanel.Dock = Right, Style = @BodySmall, Text = $Status,
                                    Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (8,0,0,0) ]
                        TextBlock [ DockPanel.Dock = Left, Text = "▸", Visibility = $IsCollapsed << ToVisibility,
                                    Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (0,0,6,0) ]
                        TextBlock [ DockPanel.Dock = Left, Text = "▾", Visibility = $IsExpanded << ToVisibility,
                                    Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (0,0,6,0) ]
                        TextBlock [ DockPanel.Dock = Left, Style = @LabelLarge, Text = $Name,
                                    Foreground = @OnSurface, VerticalAlignment = Center ]
                        // Fill slot — clipped so a long description is cut at the
                        // status boundary instead of painting over "done".
                        Border [ ClipToBounds = true, Background = #00000000,
                                 Visibility = $HasDescription << ToVisibility, Margin = (8,0,8,0) ] {
                            TextBlock [ Style = @BodySmall, Text = $Description,
                                        Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                        }
                    }
                }
                StackPanel [ Orientation = Vertical, Visibility = $IsExpanded << ToVisibility, Margin = (2,4,2,2) ] {
                    StackPanel [ Orientation = Vertical, Visibility = $HasCommand << ToVisibility ] {
                        TextBlock [ Style = @LabelSmall, Text = "IN", Foreground = @OnSurfaceVariant, Margin = (0,0,0,2) ]
                        Border [ Style = @ToolMonoBox ] {
                            TextBlock [ Style = @BodySmall, FontFamily = "Consolas", Text = $Command,
                                        Foreground = @OnSurface, TextWrapping = Wrap ]
                        }
                    }
                    StackPanel [ Orientation = Vertical, Visibility = $HasOutput << ToVisibility, Margin = (0,6,0,0) ] {
                        TextBlock [ Style = @LabelSmall, Text = "OUT", Foreground = @OnSurfaceVariant, Margin = (0,0,0,2) ]
                        Border [ Style = @ToolMonoBox ] {
                            TextBlock [ Style = @BodySmall, FontFamily = "Consolas", Text = $Output,
                                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
                        }
                    }
                }
            }
        }
    }

    // Compact filled button — a faithful copy of the framework's
    // DefaultFilledButton with a tighter state-layer padding (12,5 vs 24,10).
    // Padding lives inside the template (not a Button DP), so a smaller
    // Submit means its own template. Used by the card's Submit.
    Template x:key="CompactButton" [ TargetType = Button ] {
        Border x:name="PART_Border"
            [ Background           = @Primary,
              BorderThickness      = (0),
              CornerRadius         = $$CornerRadius,
              TextBlock.Foreground = @OnPrimary,
              TextBlock.FontFamily = @LabelLargeFont,
              TextBlock.FontWeight = @LabelLargeWeight,
              TextBlock.FontSize = @LabelLargeSize,
              TextBlock.LineHeight = @LabelLargeLineHeight,
              TextBlock.LetterSpacing = @LabelLargeTracking ] {
            Border x:name="PART_StateLayer"
                [ Background   = #00000000,
                  CornerRadius = $$CornerRadius,
                  Padding      = (12,5,12,5) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Background = @OnPrimaryHoverLayer; }
        when ( IsPressed ) { PART_StateLayer.Background = @OnPrimaryPressLayer; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @DisabledContentOpacity; }
    }

    // ── AskUserQuestion card ────────────────────────────────────────────────────
    // The agent called ask_user_question: a bordered card of QuestionVMs. While
    // pending ($IsPending) it shows the questions + a Submit (enabled once every
    // question has a selection); after answering it collapses to a compact recap.
    DataTemplate [ DataType = QuestionCard ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 10,
                 Background = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4) ] {
            StackPanel [ Orientation = Vertical ] {
                StackPanel [ Orientation = Vertical, Visibility = $IsPending << ToVisibility ] {
                    ItemsControl [ ItemsSource = $Questions, ItemsPanel = @VerticalStackPanel ]
                    Button [ Command = $SubmitCommand, IsEnabled = $IsSubmittable,
                             HorizontalAlignment = Right, Margin = (0,10,0,0), Template = @CompactButton ] {
                        TextBlock [ Text = "Submit" ]
                    }
                }
                TextBlock [ Text = $AnswerSummary, Visibility = $IsAnswered << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    // ── tool-approval card ──────────────────────────────────────────────────────
    // The agent asked to use a tool needing permission: tool + command, a button
    // row (Approve once / Always allow <prefix> / Deny) with a depleting countdown
    // ring at the right; on 10s expiry the card auto-approves once. Collapses to a
    // recap after answering.
    DataTemplate [ DataType = ToolApprovalCard ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 10,
                 Background = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4) ] {
            StackPanel [ Orientation = Vertical ] {
                StackPanel [ Orientation = Vertical, Visibility = $IsPending << ToVisibility ] {
                    TextBlock [ Text = $ToolName, Foreground = @OnSurface, Style = @BodyMedium ]
                    Border [ Style = @ToolMonoBox, Visibility = $HasCommand << ToVisibility, Margin = (0,6,0,0) ] {
                        TextBlock [ FontFamily = "Consolas", Text = $Command, Foreground = @OnSurface, TextWrapping = Wrap ]
                    }
                    DockPanel [ LastChildFill = false, Margin = (0,10,0,0) ] {
                        ProgressIndicator [ DockPanel.Dock = Right, Variant = Circular, Value = $Countdown,
                                            Width = 20, Height = 20, Margin = (8,0,0,0) ]
                        Button [ DockPanel.Dock = Left, Command = $ApproveOnceCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = "Approve once" ]
                        }
                        Button [ DockPanel.Dock = Left, Command = $AllowAlwaysCommand, Template = @CompactButton, Margin = (0,0,6,0) ] {
                            TextBlock [ Text = $AllowAlwaysLabel ]
                        }
                        Button [ DockPanel.Dock = Left, Command = $DenyCommand, Template = @CompactButton ] {
                            TextBlock [ Text = "Deny" ]
                        }
                    }
                }
                TextBlock [ Text = $Recap, Visibility = $IsAnswered << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    // One approved-tool row: the rule label ("Bash: python" / "WebFetch") + Revoke.
    DataTemplate [ DataType = ApprovalRuleRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            Button [ DockPanel.Dock = Right, Command = $RevokeCommand, Template = @CompactButton, Margin = (8,0,0,0) ] {
                TextBlock [ Text = "Revoke" ]
            }
            TextBlock [ FontFamily = "Consolas", Text = $Label, Foreground = @OnSurface, VerticalAlignment = Center ]
        }
    }

    // ── create_project card ─────────────────────────────────────────────────────
    // The agent called create_project: a bordered card hosting the reused New
    // Project form ($Form → DataTemplate[NewProjectDialogModel]) while pending;
    // after Create/Cancel it collapses to a one-line recap.
    DataTemplate [ DataType = NewProjectCard ] {
        Border [ BorderBrush = @OutlineVariant, BorderThickness = (1,1,1,1), CornerRadius = 10,
                 Background = @SurfaceContainer, Padding = (12,10,12,12), Margin = (0,4,20,4) ] {
            StackPanel [ Orientation = Vertical ] {
                ContentControl [ Content = $Form, Visibility = $IsPending << ToVisibility ]
                TextBlock [ Text = $ResultSummary, Visibility = $IsDone << ToVisibility,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    // One question: a header chip, the prompt, its selectable options, and an
    // "Other" toggle that enables a free-text box. Single-select questions get
    // a RadioButtonGroup (it owns mutual exclusion); multi-select gets the
    // independent-toggle list. Exactly one is visible per question.
    DataTemplate [ DataType = QuestionVM ] {
        StackPanel [ Orientation = Vertical, Margin = (0,0,0,12) ] {
            Border [ HorizontalAlignment = Left, Background = @SurfaceContainerHigh, CornerRadius = 4,
                     Padding = (6,1,6,1), Margin = (0,0,0,4) ] {
                TextBlock [ Style = @BodySmall, Text = $Header, Foreground = @OnSurfaceVariant ]
            }
            TextBlock [ Text = $Question, Foreground = @OnSurface, TextWrapping = Wrap, Margin = (0,0,0,6) ]
            // Single-select: labelled radio rows. SelectedItem two-ways back to
            // the VM's SelectedOption; each row hosts the OptionVM and renders
            // it through the DataTemplate[OptionVM] below.
            RadioButtonGroup [ ItemsSource = $Options, SelectedItem = $SelectedOption,
                               Visibility = $IsSingleSelect << ToVisibility ]
            // Multi-select: independent toggles (checkbox semantics). Both
            // lists include the trailing "Other" row (last option).
            ItemsControl [ ItemsSource = $Options, ItemsPanel = @VerticalStackPanel,
                           ItemTemplate = @OptionToggleTemplate,
                           Visibility = $IsMultiSelect << ToVisibility ]
            // Free-text editor — revealed only while the "Other" row is chosen.
            TextBox [ Text = $OtherText, Visibility = $IsOtherChosen << ToVisibility, Margin = (0,4,0,0) ]
        }
    }

    // One option's label + optional description. Implicit-by-DataType, so a
    // RadioButtonItem (single-select) slots it as its Content automatically.
    DataTemplate [ DataType = OptionVM ] {
        StackPanel [ Orientation = Vertical ] {
            TextBlock [ Text = $Label, Foreground = @OnSurface, TextWrapping = Wrap ]
            TextBlock [ Text = $Description, Visibility = $HasDescription << ToVisibility,
                        Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
        }
    }

    // Multi-select row: a ToggleButton whose IsChecked binds the option's
    // IsSelected (TwoWay). x:key'd, so it's reachable only via
    // @OptionToggleTemplate and does NOT shadow the implicit OptionVM
    // template the single-select radio rows resolve.
    DataTemplate x:key="OptionToggleTemplate" [ DataType = OptionVM ] {
        ToggleButton [ IsChecked = $IsSelected, HorizontalAlignment = Stretch, Margin = (0,2,0,0) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = $Label, Foreground = @OnSurface, TextWrapping = Wrap ]
                TextBlock [ Text = $Description, Visibility = $HasDescription << ToVisibility,
                            Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }
}
